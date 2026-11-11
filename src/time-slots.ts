import type { moment } from 'obsidian';

type Moment = ReturnType<typeof moment>;

export interface TimeSlot {
	minutes: number; // 0:00 からの経過分
	heading: string;
	tag: string;
}

export interface Placement {
	date: Moment; // 追記先デイリーノートの日付
	slot: TimeSlot | null; // 追記先の見出し（見出しなしなら null）
}

export interface Inserted {
	data: string; // 追記後の内容
	line: number; // 追記した行の番号（0から）
}

export const isBlank = (s: string | undefined): boolean => (s ?? '').trim() === '';

/** 中身のない箇条書き（「- 」など、記号とスペースだけ） */
export const isEmptyItem = (s: string | undefined): boolean => /^[ \t]*[-*+][ \t]*$/.test(s ?? '');

/** 追記する位置の上で詰める行（空行と空の箇条書き） */
const isSpace = (s: string | undefined): boolean => isBlank(s) || isEmptyItem(s);

/** 「H:mm」「HH:mm」を 0:00 からの分にする。不正なら null */
export function parseTime(value: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	const h = Number(m?.[1]);
	const min = Number(m?.[2]);
	return m && h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** 「時刻 | 見出し | タグ」を1行ずつ読み、時刻順に並べて返す */
export function parseTimeSlots(value: string): { slots: TimeSlot[]; errors: string[] } {
	const slots: TimeSlot[] = [];
	const errors: string[] = [];

	value.split('\n').forEach((raw, i) => {
		if (isBlank(raw)) return;
		const [time = '', heading = '', tag = ''] = raw.split('|').map((s) => s.trim());
		const m = /^(\d{1,2}):(\d{2})$/.exec(time);
		const h = Number(m?.[1]);
		const min = Number(m?.[2]);
		if (!m || h > 23 || min > 59) {
			errors.push(`Line ${i + 1}: invalid time "${time}".`);
			return;
		}
		if (heading === '') {
			errors.push(`Line ${i + 1}: heading is empty.`);
			return;
		}
		slots.push({ minutes: h * 60 + min, heading, tag });
	});

	slots.sort((a, b) => a.minutes - b.minutes);
	return { slots, errors };
}

/** 時刻から、追記先の日付と見出しを決める */
export function resolvePlacement(at: Moment, slots: TimeSlot[], toPreviousDay: boolean): Placement {
	const first = slots[0];
	const last = slots[slots.length - 1];
	if (!first || !last) return { date: at.clone(), slot: null };

	const minutes = at.hours() * 60 + at.minutes();
	if (minutes < first.minutes) {
		return toPreviousDay
			? { date: at.clone().subtract(1, 'day'), slot: last }
			: { date: at.clone(), slot: null };
	}

	let current = first;
	for (const s of slots) {
		if (s.minutes <= minutes) current = s;
	}
	return { date: at.clone(), slot: current };
}

/** 1日の境界（0:00 からの分）。これより前の時刻は前日として扱う */
export function dayBoundary(slots: TimeSlot[], toPreviousDay: boolean): number {
	return toPreviousDay ? (slots[0]?.minutes ?? 0) : 0;
}

/** 境界を考慮した論理上の日付（その日の 0:00）を返す */
export function logicalDate(at: Moment, boundary: number): Moment {
	return at.clone().subtract(boundary, 'minutes').startOf('day');
}

interface HeadingLine {
	index: number;
	level: number;
	text: string;
}

/** 見出し行を探す（コードブロックの中は除く） */
function findHeadings(lines: string[]): HeadingLine[] {
	const result: HeadingLine[] = [];
	let fence: string | null = null;

	lines.forEach((line, index) => {
		const f = /^\s*(```|~~~)/.exec(line);
		if (f) {
			const mark = f[1] ?? '';
			if (fence === null) fence = mark;
			else if (mark === fence) fence = null;
			return;
		}
		if (fence !== null) return;
		const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
		if (m) result.push({ index, level: (m[1] ?? '').length, text: m[2] ?? '' });
	});
	return result;
}

/** 見出し（レベルは問わない）の節の行。次の同レベル以上の見出しまで。見出しがなければ空 */
function sectionLines(data: string, heading: string): string[] {
	const lines = data.split('\n');
	const headings = findHeadings(lines);
	const target = headings.find((h) => h.text === heading);
	if (!target) return [];
	const next = headings.find((h) => h.index > target.index && h.level <= target.level);
	return lines.slice(target.index + 1, next ? next.index : lines.length);
}

const OPEN_CHECKBOX = /^[ \t]*[-*+] \[ \]/;

/**
 * 見出しの節から、未チェックのチェックボックスを子の行ごと取り出し、1段インデントして返す。
 * チェック済みや普通の項目、本文は、子ごと飛ばす
 */
export function openActions(data: string, heading: string): string[] {
	const section = sectionLines(data, heading);
	const result: string[] = [];
	let base = -1; // 直前の項目のインデントの長さ
	let copying = false;
	for (const line of section) {
		if (isBlank(line)) continue;
		const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
		// 直前の項目より深い行はその子
		if (base >= 0 && indent > base) {
			if (copying) result.push(`\t${line.slice(base)}`);
			continue;
		}
		base = indent;
		copying = OPEN_CHECKBOX.test(line);
		if (copying) result.push(`\t${line.slice(base)}`);
	}
	return result;
}

/** Markdown の記法を外して、見える文字だけにする（タスク一覧の表示名用）。タグはそのまま */
export function plainText(md: string): string {
	return (
		md
			// 埋め込みと画像は消す
			.replace(/!\[\[[^\]]*\]\]/g, '')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
			// ウィキリンクは別名、なければリンク先
			.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
			.replace(/\[\[([^\]]*)\]\]/g, '$1')
			// 脚注は消し、リンクは表示する文字、自動リンクは URL
			.replace(/\[\^[^\]]*\]/g, '')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/<(https?:\/\/[^>]+)>/g, '$1')
			// HTML タグは消す
			.replace(/<\/?[A-Za-z][^>]*>/g, '')
			// コード、太字、取り消し線、ハイライト、斜体は中身だけ
			.replace(/`([^`]*)`/g, '$1')
			.replace(/(\*\*|~~|==)(.+?)\1/g, '$2')
			.replace(/\*([^*]+)\*/g, '$1')
			// _ は単語の途中（snake_case）を壊さないよう、前後が英数字でないときだけ
			.replace(/(^|[^A-Za-z0-9])(__?)([^_]+?)\2(?![A-Za-z0-9])/g, '$1$3')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/** 見出しの節で、一番上の未チェックのチェックボックスの文字列（インデントは問わない）。なければ null */
export function firstOpenItem(data: string, heading: string): string | null {
	for (const line of sectionLines(data, heading)) {
		const m = OPEN_CHECKBOX.exec(line);
		const text = m ? plainText(line.slice(m[0].length)) : '';
		if (text !== '') return text;
	}
	return null;
}

/** 「## 見出し」の節の末尾に1行追加する。見出しがなければ作る */
export function insertUnderHeading(
	data: string,
	slot: TimeSlot,
	slots: TimeSlot[],
	line: string,
	withRule: boolean,
): Inserted {
	const lines = data.split('\n');
	const headings = findHeadings(lines);
	const block = withRule ? [`## ${slot.heading}`, '---', line] : [`## ${slot.heading}`, line];

	// 見出しがある場合：次の同レベル以上の見出しの直前（末尾の空行は詰める）。
	// 末尾の空の箇条書きは消し、空行は追記した行の後ろに残す
	const target = headings.find((h) => h.level === 2 && h.text === slot.heading);
	if (target) {
		const next = headings.find((h) => h.index > target.index && h.level <= 2);
		const stop = next ? next.index : lines.length;
		let end = stop;
		while (end > target.index + 1 && isSpace(lines[end - 1])) end--;
		lines.splice(end, stop - end, line, ...lines.slice(end, stop).filter(isBlank));
		return { data: lines.join('\n'), line: end };
	}

	// 見出しがない場合：後の時間帯の見出しがあればその前に、なければ末尾に作る。
	// 前後に空行は入れない（直前の空行と空の箇条書きも詰める）
	const later = new Set(slots.slice(slots.indexOf(slot) + 1).map((s) => s.heading));
	const laterHeading = headings.find((h) => h.level === 2 && later.has(h.text));
	if (laterHeading) {
		let start = laterHeading.index;
		while (start > 0 && isSpace(lines[start - 1])) start--;
		lines.splice(start, laterHeading.index - start, ...block);
		return { data: lines.join('\n'), line: start + block.length - 1 };
	}

	while (lines.length > 0 && isSpace(lines[lines.length - 1])) lines.pop();
	const start = lines.length;
	lines.push(...block, '');
	return { data: lines.join('\n'), line: start + block.length - 1 };
}
