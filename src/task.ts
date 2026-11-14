import { moment } from 'obsidian';
import { logicalDate, parseTime, resolvePlacement } from './time-slots';
import type { TimeSlot } from './time-slots';

export type Moment = ReturnType<typeof moment>;

export interface TaskPropNames {
	cycle: string;
	section: string;
	scheduled: string;
	start: string;
	end: string;
	time: string;
	skip: string;
	tag: string;
	location: string;
}

export interface TaskDate {
	value: Moment;
	hasTime: boolean;
}

export interface TaskProps {
	cycle: string[];
	section: string;
	scheduled: TaskDate | null;
	start: Moment | null;
	startKnown: boolean; // 開始日時に時刻があるか（開始忘れでは日付だけを書くので false）
	end: Moment | null;
	time: number | null; // 予定時刻（0:00 からの分）
	skipped: TaskDate | null;
	tag: string; // 1つ目のタグ（先頭の # は外す。なければ空）
}

export interface TaskContext {
	today: Moment; // 論理上の今日（0:00）
	boundary: number; // 1日の境界（分）
	slots: TimeSlot[];
	toPreviousDay: boolean;
	dayEnd: number | null; // その日の終了時刻（0:00 からの分。未設定なら null）
	everyday: string;
	weekdays: string[]; // 月曜日から順に7つ
	workday: string;
	holiday: string;
	isHoliday: boolean; // 論理上の今日が休日か
}

/** グループの並び順。実行中、その他、時間帯（0, 1, 2…）の順 */
export const GROUP_RUNNING = -2;
export const GROUP_OTHER = -1;

const DATE_FORMATS = ['YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD'];

function toTaskDate(value: unknown): TaskDate | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	const v = value.trim();
	const m = moment(v, DATE_FORMATS, true);
	return m.isValid() ? { value: m, hasTime: /\d:\d{2}/.test(v) } : null;
}

/** 「HH:mm」のテキストを 0:00 からの分にする。不正なら null */
function toMinutes(value: unknown): number | null {
	return typeof value === 'string' ? parseTime(value) : null;
}

function toStringList(value: unknown): string[] {
	const list: unknown[] = Array.isArray(value) ? value : [value];
	return list
		.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
		.map((v) => String(v).trim())
		.filter((v) => v !== '');
}

/** プロパティからタスクの情報を読む。タスクでなければ null */
export function readTask(fm: Record<string, unknown> | undefined, names: TaskPropNames): TaskProps | null {
	if (!fm) return null;
	const cycle = toStringList(fm[names.cycle]);
	const scheduled = toTaskDate(fm[names.scheduled]);
	const startDate = toTaskDate(fm[names.start]);
	const start = startDate?.value ?? null;
	if (cycle.length === 0 && !scheduled && !start) return null;

	const section = fm[names.section];
	return {
		cycle,
		section: typeof section === 'string' ? section.trim() : '',
		scheduled,
		start,
		startKnown: startDate?.hasTime ?? false,
		end: toTaskDate(fm[names.end])?.value ?? null,
		time: toMinutes(fm[names.time]),
		skipped: toTaskDate(fm[names.skip]),
		tag: (toStringList(fm[names.tag])[0] ?? '').replace(/^#/, ''),
	};
}

function dayOf(d: TaskDate, boundary: number): Moment {
	return d.hasTime ? logicalDate(d.value, boundary) : d.value.clone().startOf('day');
}

/** 予定日時の論理上の日付。日付だけなら、その日のまま */
export function scheduledDay(d: TaskDate, ctx: TaskContext): Moment {
	return dayOf(d, ctx.boundary);
}

/** 予定日時。空なら予定時刻を、論理上の今日のその時刻とする（1日の区切りより前なら翌日の暦日） */
export function effectiveScheduled(t: TaskProps, ctx: TaskContext): TaskDate | null {
	if (t.scheduled) return t.scheduled;
	if (t.time === null) return null;
	const value = ctx.today.clone().add(t.time, 'minutes');
	if (t.time < ctx.boundary) value.add(1, 'day');
	return { value, hasTime: true };
}

/** 休日のノートの予定日時の論理上の日付が today なら、休日 */
export function isHolidayToday(
	fm: Record<string, unknown> | undefined,
	scheduledProp: string,
	today: Moment,
	boundary: number,
): boolean {
	const d = toTaskDate(fm?.[scheduledProp]);
	return d !== null && dayOf(d, boundary).isSame(today, 'day');
}

/** 実行中か。開始時に終了日時を空にするので、終了日時が開始日時と同じ分なら終了済み */
export function isRunning(t: TaskProps): boolean {
	return t.start !== null && (t.end === null || t.end.isBefore(t.start));
}

function isDoneToday(t: TaskProps, ctx: TaskContext): boolean {
	return !isRunning(t) && t.end !== null && logicalDate(t.end, ctx.boundary).isSame(ctx.today, 'day');
}

function matchesCycle(t: TaskProps, ctx: TaskContext): boolean {
	const values = new Set(t.cycle.map((v) => v.toLowerCase()));
	const weekday = ctx.weekdays[ctx.today.isoWeekday() - 1] ?? '';
	const dayType = ctx.isHoliday ? ctx.holiday : ctx.workday;
	return (
		values.has(ctx.everyday.toLowerCase()) ||
		values.has(weekday.toLowerCase()) ||
		values.has(dayType.toLowerCase())
	);
}

/** サイドバーに表示するか */
export function isVisible(t: TaskProps, ctx: TaskContext): boolean {
	if (isRunning(t)) return true;
	// 今日スキップしたタスクは、実行中でなければ、ほかの条件より優先して隠す
	if (t.skipped && scheduledDay(t.skipped, ctx).isSame(ctx.today, 'day')) return false;
	if (t.scheduled) {
		// 未来の予定は周期より優先して隠す。今日以前の予定は、終了して空になるまで表示する
		return !scheduledDay(t.scheduled, ctx).isAfter(ctx.today, 'day');
	}
	if (isDoneToday(t, ctx)) return false;
	return matchesCycle(t, ctx);
}

/** グループ（GROUP_RUNNING、GROUP_OTHER、または時間帯の番号） */
export function groupOf(t: TaskProps, ctx: TaskContext): number {
	if (isRunning(t)) return GROUP_RUNNING;

	// 予定日を過ぎたタスクは、セクションも無視して「その他」に入れる
	if (t.scheduled && scheduledDay(t.scheduled, ctx).isBefore(ctx.today, 'day')) return GROUP_OTHER;

	// 今日の予定日時（空なら予定時刻）に時刻があれば、その時刻の時間帯
	const scheduled = effectiveScheduled(t, ctx);
	if (scheduled?.hasTime && scheduledDay(scheduled, ctx).isSame(ctx.today, 'day')) {
		const { slot } = resolvePlacement(scheduled.value, ctx.slots, ctx.toPreviousDay);
		if (slot) return ctx.slots.indexOf(slot);
	}

	// セクションのタグに一致する時間帯
	const index = ctx.slots.findIndex((s) => s.tag !== '' && s.tag === t.section);
	return index >= 0 ? index : GROUP_OTHER;
}

/** 今の時間帯の番号（記録先と同じ決め方）。見出しを使わない、または時間帯の前なら null */
export function currentSlot(ctx: TaskContext, now: Moment): number | null {
	const { slot } = resolvePlacement(now, ctx.slots, ctx.toPreviousDay);
	return slot ? ctx.slots.indexOf(slot) : null;
}

/** 時間帯の終わり。最後の時間帯は、その日の終了時刻（なければ翌日の最初の時間帯） */
export function slotEnd(ctx: TaskContext, index: number): Moment | null {
	const slot = ctx.slots[index];
	const first = ctx.slots[0];
	if (!slot || !first) return null;
	const next = ctx.slots[index + 1];
	if (next) return ctx.today.clone().add(next.minutes, 'minutes');
	let end = ctx.dayEnd ?? first.minutes;
	if (end <= slot.minutes) end += 1440; // 最後の時間帯より前の時刻は、翌日の暦日
	return ctx.today.clone().add(end, 'minutes');
}

function compareMoment(a: Moment | null, b: Moment | null): number {
	if (a && b) return a.valueOf() - b.valueOf();
	if (a) return -1;
	if (b) return 1;
	return 0;
}

/** グループ内の並び順：予定日時（空なら予定時刻）、前回の開始日時、ファイル名（値がないものは後ろ） */
export function compareTasks(
	a: { name: string; props: TaskProps; scheduled: TaskDate | null },
	b: { name: string; props: TaskProps; scheduled: TaskDate | null },
): number {
	return (
		compareMoment(a.scheduled?.value ?? null, b.scheduled?.value ?? null) ||
		compareMoment(a.props.start, b.props.start) ||
		a.name.localeCompare(b.name)
	);
}

/** 同じタグのタスクのまとまり */
export interface TagGroup<T> {
	tag: string;
	entries: T[];
}

/**
 * 並べ終えたタスクのうち、1つ目のタグが同じものが2つ以上あれば、最初のタスクの位置にまとめる。
 * タグは大文字小文字を区別しない。見出しの文字は最初のタスクの表記
 */
export function groupByTag<T extends { props: TaskProps }>(sorted: T[]): (T | TagGroup<T>)[] {
	const byTag = new Map<string, T[]>();
	for (const e of sorted) {
		const key = e.props.tag.toLowerCase();
		if (key === '') continue;
		byTag.set(key, [...(byTag.get(key) ?? []), e]);
	}

	const result: (T | TagGroup<T>)[] = [];
	const placed = new Set<string>();
	for (const e of sorted) {
		const key = e.props.tag.toLowerCase();
		const members = byTag.get(key);
		if (!members || members.length < 2) {
			result.push(e);
		} else if (!placed.has(key)) {
			placed.add(key);
			result.push({ tag: e.props.tag, entries: members });
		}
	}
	return result;
}

/** 開始日時・終了日時に書き込む形式（分単位） */
export const PROP_DATE_FORMAT = 'YYYY-MM-DDTHH:mm';

/** 開始忘れのとき、開始日時に書き込む形式（日付だけ。時刻が不明なことを表す） */
export const PROP_DAY_FORMAT = 'YYYY-MM-DD';

/** 分からない時刻と所要時間 */
export const UNKNOWN_TIME = '??:??';

/** 所要時間を「00:38」「01:05」の形にする。24時間を超えても繰り上げない（例：25:10） */
export function formatDuration(from: Moment, to: Moment): string {
	// 記録する HH:mm どうしの差と一致するよう、分単位にそろえて計算する
	const total = Math.max(
		0,
		to.clone().startOf('minute').diff(from.clone().startOf('minute'), 'minutes'),
	);
	const h = Math.floor(total / 60);
	const m = total % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(h)}:${pad(m)}`;
}
