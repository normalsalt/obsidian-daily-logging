import { moment } from 'obsidian';
import { logicalDate, resolvePlacement } from './time-slots';
import type { TimeSlot } from './time-slots';

export type Moment = ReturnType<typeof moment>;

export interface TaskPropNames {
	cycle: string;
	section: string;
	scheduled: string;
	start: string;
	end: string;
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
	end: Moment | null;
}

export interface TaskContext {
	today: Moment; // 論理上の今日（0:00）
	boundary: number; // 1日の境界（分）
	slots: TimeSlot[];
	toPreviousDay: boolean;
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
	const start = toTaskDate(fm[names.start])?.value ?? null;
	if (cycle.length === 0 && !scheduled && !start) return null;

	const section = fm[names.section];
	return {
		cycle,
		section: typeof section === 'string' ? section.trim() : '',
		scheduled,
		start,
		end: toTaskDate(fm[names.end])?.value ?? null,
	};
}

function dayOf(d: TaskDate, boundary: number): Moment {
	return d.hasTime ? logicalDate(d.value, boundary) : d.value.clone().startOf('day');
}

/** 予定日時の論理上の日付。日付だけなら、その日のまま */
export function scheduledDay(d: TaskDate, ctx: TaskContext): Moment {
	return dayOf(d, ctx.boundary);
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

	// 今日の予定日時に時刻があれば、その時刻の時間帯
	if (t.scheduled?.hasTime && scheduledDay(t.scheduled, ctx).isSame(ctx.today, 'day')) {
		const { slot } = resolvePlacement(t.scheduled.value, ctx.slots, ctx.toPreviousDay);
		if (slot) return ctx.slots.indexOf(slot);
	}

	// セクションのタグに一致する時間帯
	const index = ctx.slots.findIndex((s) => s.tag !== '' && s.tag === t.section);
	return index >= 0 ? index : GROUP_OTHER;
}

function compareMoment(a: Moment | null, b: Moment | null): number {
	if (a && b) return a.valueOf() - b.valueOf();
	if (a) return -1;
	if (b) return 1;
	return 0;
}

/** グループ内の並び順：予定日時、前回の開始日時、ファイル名（値がないものは後ろ） */
export function compareTasks(
	a: { name: string; props: TaskProps },
	b: { name: string; props: TaskProps },
): number {
	return (
		compareMoment(a.props.scheduled?.value ?? null, b.props.scheduled?.value ?? null) ||
		compareMoment(a.props.start, b.props.start) ||
		a.name.localeCompare(b.name)
	);
}

/** 開始日時・終了日時に書き込む形式（分単位） */
export const PROP_DATE_FORMAT = 'YYYY-MM-DDTHH:mm';

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
