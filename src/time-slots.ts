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

const isBlank = (s: string | undefined): boolean => (s ?? '').trim() === '';

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

	// 見出しがある場合：次の同レベル以上の見出しの直前（末尾の空行は詰める）
	const target = headings.find((h) => h.level === 2 && h.text === slot.heading);
	if (target) {
		const next = headings.find((h) => h.index > target.index && h.level <= 2);
		let end = next ? next.index : lines.length;
		while (end > target.index + 1 && isBlank(lines[end - 1])) end--;
		lines.splice(end, 0, line);
		return { data: lines.join('\n'), line: end };
	}

	// 見出しがない場合：後の時間帯の見出しがあればその前に、なければ末尾に作る
	const later = new Set(slots.slice(slots.indexOf(slot) + 1).map((s) => s.heading));
	const laterHeading = headings.find((h) => h.level === 2 && later.has(h.text));
	if (laterHeading) {
		lines.splice(laterHeading.index, 0, ...block, '');
		return { data: lines.join('\n'), line: laterHeading.index + block.length - 1 };
	}

	while (lines.length > 0 && isBlank(lines[lines.length - 1])) lines.pop();
	if (lines.length > 0) lines.push('');
	const start = lines.length;
	lines.push(...block, '');
	return { data: lines.join('\n'), line: start + block.length - 1 };
}
