import { TFile, moment, normalizePath, requestUrl } from 'obsidian';
import type { App } from 'obsidian';
import { reportError } from './daily-notes';
import { PROP_DATE_FORMAT } from './task';
import type { TaskPropNames } from './task';

/** GAS ウェブアプリ（~/Documents/FetchEvents）が返す予定 */
export interface CalendarEvent {
	summary: string;
	start: string; // dateTime（ISO 8601）、終日予定は date（YYYY-MM-DD）
	location: string;
	description: string;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 予定を取得する。範囲は今から、翌日の until 時刻（HH:mm）までに始まる予定 */
export async function fetchCalendarEvents(
	url: string,
	token: string,
	until: string,
): Promise<CalendarEvent[]> {
	const query = new URLSearchParams({ token, until });
	const sep = url.includes('?') ? '&' : '?';
	const res = await requestUrl({ url: `${url}${sep}${query.toString()}`, throw: false });
	if (res.status !== 200) {
		throw new Error(`Calendar API returned HTTP ${res.status}.`);
	}

	// GAS はエラーも 200 で { error } を返す
	const body: unknown = res.json;
	if (typeof body !== 'object' || body === null) {
		throw new Error('Calendar API returned an unexpected response.');
	}
	if ('error' in body) {
		throw new Error(`Calendar API error: ${String(body.error)}`);
	}
	if (!('events' in body) || !Array.isArray(body.events)) {
		throw new Error('Calendar API returned an unexpected response.');
	}

	return (body.events as unknown[])
		.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
		.map((e) => ({
			summary: asString(e.summary),
			start: asString(e.start),
			location: asString(e.location),
			description: asString(e.description),
		}));
}

/** ファイル名に使えない文字、リンクを壊す文字を空白にする */
function toFileName(summary: string): string {
	return summary.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 予定日時プロパティに書く値。時刻があれば端末のタイムゾーンで分まで、終日予定は日付だけ */
function toScheduled(start: string): string | null {
	if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
	const m = moment(start, moment.ISO_8601, true);
	return m.isValid() ? m.format(PROP_DATE_FORMAT) : null;
}

/**
 * 本文の最後の行のすぐ下に、空行を挟まずに説明を追記する。末尾の空行は、説明の後ろに残す。
 * 行頭のスペースは2つごとにタブにする（余った1つはスペースにする）。
 * Google カレンダーの説明は HTML 由来で、&nbsp; がノーブレークスペースで入るので、それも数える。
 * 同じ説明がすでに本文にあれば何もしない（毎日取得しても重ならないように）
 */
function appendDescription(data: string, description: string): string {
	const raw = description.replace(/\r\n?/g, '\n').trim();
	const text = raw.replace(
		/^[ \u00a0]+/gm,
		(s) => '\t'.repeat(Math.floor(s.length / 2)) + (s.length % 2 ? ' ' : ''),
	);
	// タブにする前に追記した説明も、同じものとみなす
	if (text === '' || data.includes(text) || data.includes(raw)) return data;

	// 最後の内容の行の改行から後（末尾の空行を含む）
	const m = /\n(?:[ \t]*\n)*[ \t]*$/.exec(data);
	const head = m ? data.slice(0, m.index) : data;
	const tail = m ? data.slice(m.index) : '\n';
	return head === '' ? `${text}${tail}` : `${head}\n${text}${tail}`;
}

/**
 * 予定ごとに、保管庫直下の同じ名前のファイルを作るか更新する。
 * 予定日時と場所のプロパティは毎回上書きする（空なら値だけ空にする）。説明は本文に追記する
 */
export async function syncCalendarEvents(
	app: App,
	events: CalendarEvent[],
	names: TaskPropNames,
): Promise<{ created: number; updated: number }> {
	let created = 0;
	let updated = 0;

	for (const event of events) {
		const name = toFileName(event.summary);
		if (name === '') continue;
		try {
			const path = normalizePath(`${name}.md`);
			let file = app.vault.getFileByPath(path);
			const isNew = !(file instanceof TFile);
			if (!file) file = await app.vault.create(path, '');

			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				fm[names.scheduled] = toScheduled(event.start);
				fm[names.location] = event.location || null;
			});
			await app.vault.process(file, (data) => appendDescription(data, event.description));
			if (isNew) created++;
			else updated++;
		} catch (err) {
			reportError(err); // 1件失敗しても、次の予定へ進む
		}
	}
	return { created, updated };
}
