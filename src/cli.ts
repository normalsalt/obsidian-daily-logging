import { moment, normalizePath } from 'obsidian';
import type { CliData, CliFlags, TFile } from 'obsidian';
import type DailyLoggingPlugin from './main';
import { NO_DAILY_NOTES_MESSAGE, getDailyNotes, isDailyNote, reportError } from './daily-notes';
import type { LoggedLine } from './daily-notes';
import {
	GROUP_OTHER,
	GROUP_RUNNING,
	GROUP_SKIPPED,
	PROP_DATE_FORMAT,
	PROP_DAY_FORMAT,
	UNKNOWN_TIME,
	currentSlot,
	formatDuration,
	isRunning,
	scheduledDay,
	slotEnd,
} from './task';
import type { Moment, TaskContext, TaskDate, TaskEntry } from './task';
import { parseTime } from './time-slots';

/** 失敗を伝える。CLI の出力は1行の「Error: …」にする */
class CliError extends Error {}

/** 対象のファイルを指定するフラグ（他の CLI コマンドと同じ） */
const FILE_FLAGS: CliFlags = {
	file: { value: '<name>', description: 'Task note name, resolved like a link' },
	path: { value: '<path>', description: 'Task note path' },
};

/**
 * Obsidian CLI のコマンドを登録する（`obsidian daily-logging:tasks` など）。
 * CLI から実行したときは画面を変えない（デイリーノートを表示せず、モーダルも出さない）。
 * 出すはずだった情報は、出力で返す
 */
export function registerCli(plugin: DailyLoggingPlugin): void {
	const add = (
		action: string,
		description: string,
		flags: CliFlags | null,
		run: (params: CliData) => Promise<string>,
	) => {
		plugin.registerCliHandler(`daily-logging:${action}`, description, flags, async (params) => {
			try {
				return await run(params);
			} catch (err) {
				if (err instanceof CliError) return `Error: ${err.message}`;
				reportError(err);
				return `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
		});
	};

	add(
		'tasks',
		"List today's tasks, in the same order as the task list",
		{ format: { value: 'text|json', description: 'Output format (default: text)' } },
		(params) => listTasks(plugin, params.format === 'json'),
	);

	add(
		'unstarted',
		'List notes at the top level of the vault that have the repeat or scheduled property, even empty, and have never been started',
		{ format: { value: 'text|json', description: 'Output format (default: text)' } },
		(params) => listUnstarted(plugin, params.format === 'json'),
	);

	const taskAction = (
		action: string,
		description: string,
		needRunning: boolean,
		run: (file: TFile) => Promise<string>,
	) =>
		add(action, description, FILE_FLAGS, async (params) => {
			const file = targetFile(plugin, params);
			const state = plugin.taskState(file);
			if (state === null) throw new CliError(`${file.path} isn't a task note.`);
			if (needRunning && state !== 'running') throw new CliError(`${file.basename} isn't running.`);
			if (!needRunning && state === 'running') throw new CliError(`${file.basename} is already running.`);
			requireDailyNotes(plugin);
			return run(file);
		});

	taskAction('start', 'Start a task', false, async (file) => {
		const { logged, links } = await plugin.beginTask(file, false, false);
		return [loggedText(logged), ...linkLines(links)].join('\n');
	});
	taskAction('forgot-start', 'Mark a task as running from an unknown time', false, async (file) => {
		const { logged, links } = await plugin.beginTask(file, true, false);
		return [loggedText(logged), ...linkLines(links)].join('\n');
	});
	taskAction('end', 'End a running task', true, async (file) =>
		loggedText(await plugin.finishTask(file, 'end', false)),
	);
	taskAction('interrupt', 'Interrupt a running task', true, async (file) =>
		loggedText(await plugin.finishTask(file, 'interrupt', false)),
	);
	taskAction('forgot-end', 'End a running task at an unknown time', true, async (file) =>
		loggedText(await plugin.finishTask(file, 'forgotEnd', false)),
	);
	taskAction('done', 'Mark a task as already done', false, async (file) =>
		loggedText(await plugin.finishTask(file, 'done', false)),
	);
	taskAction('skip', 'Skip a task for today', false, async (file) => {
		const { logged, repeats } = await plugin.skipTask(file, false);
		const lines = [plugin.settings.logSkip ? loggedText(logged) : 'Skipped.'];
		if (!repeats) {
			lines.push(
				`Note: ${file.basename} has no repeat days, so it won't appear in the task list again until it is scheduled.`,
			);
		}
		return lines.join('\n');
	});

	add(
		'schedule',
		'Set when a task is scheduled. Nothing is logged',
		{
			...FILE_FLAGS,
			at: {
				value: '<YYYY-MM-DD HH:mm|YYYY-MM-DD|HH:mm>',
				description: 'Date and time. HH:mm alone means that time today',
			},
			clear: { description: 'Clear the scheduled date and time instead' },
		},
		async (params) => {
			const file = targetFile(plugin, params);
			if (plugin.taskState(file) === null) throw new CliError(`${file.path} isn't a task note.`);
			if (params.clear === 'true') {
				await plugin.scheduleTask(file, null);
				return `Cleared the schedule of ${file.basename}.`;
			}
			const at = parseAt(params.at, plugin.taskContext());
			await plugin.scheduleTask(file, at);
			return `Scheduled ${file.basename} for ${at.value.format(at.hasTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD')}.`;
		},
	);

	add(
		'create',
		'Create a task note at the top level of the vault. Nothing is logged',
		{
			name: { value: '<text>', description: 'Note name', required: true },
			repeat: { value: '<days>', description: 'Comma-separated repeat values, such as Workday or Monday' },
			at: {
				value: '<YYYY-MM-DD HH:mm|YYYY-MM-DD|HH:mm>',
				description: 'Scheduled date and time. HH:mm alone means that time today',
			},
			time: { value: '<HH:mm>', description: 'Time of day, used when the scheduled date is empty' },
			section: { value: '<tag>', description: 'Tag of the time slot' },
			tag: { value: '<text>', description: 'Tag to group the task under' },
			estimate: { value: '<minutes>', description: 'Estimated time in minutes' },
			location: { value: '<text>', description: 'URL or link to show when the task starts' },
			title: { value: '<text>', description: 'Name shown in the task list, as a checkbox under the title heading' },
		},
		(params) => createTask(plugin, params),
	);

	add(
		'interruption',
		'Interrupt every running task and log an interruption',
		{ name: { value: '<text>', description: 'What interrupted you', required: true } },
		async (params) => {
			const name = (params.name ?? '').trim();
			if (name === '' || name === 'true') throw new CliError('Enter a name with name=<text>.');
			requireDailyNotes(plugin);
			return loggedText(await plugin.logInterruption(name, false));
		},
	);

	add(
		'bedtime',
		'Skip every task in the list, ending running ones, and log bedtime',
		{ confirm: { description: 'Do it. Without this flag, only shows what would happen' } },
		async (params) => {
			const ctx = plugin.taskContext();
			const entries = await plugin.bedtimeTasks(ctx);
			if (params.confirm !== 'true') {
				const running = entries.filter((e) => isRunning(e.props)).length;
				return `${entries.length} tasks will be skipped (${running} running tasks are ended first). Add confirm to go to bed.`;
			}
			requireDailyNotes(plugin);
			return loggedText(await plugin.goToBed(entries.map((e) => e.file), false));
		},
	);

	add('fetch-calendar', 'Fetch calendar events and update their notes', null, async () => {
		if (!plugin.calendarConfig()) throw new CliError('Set the web app URL and token in the Calendar settings.');
		const result = await plugin.syncCalendar();
		if (!result) throw new CliError('Events are already being fetched.');
		return `Calendar: ${result.created} created, ${result.updated} updated.`;
	});
}

/**
 * schedule の at を予定日時にする。HH:mm だけなら、予定時刻と同じく論理上の今日のその時刻
 * （1日の区切りより前なら翌日の暦日）
 */
function parseAt(value: string | undefined, ctx: TaskContext): TaskDate {
	const v = value === undefined || value === 'true' ? '' : value.trim();
	if (v === '') throw new CliError('Enter a date and time with at=<YYYY-MM-DD HH:mm>, or use clear.');

	const minutes = parseTime(v);
	if (minutes !== null) {
		const at = ctx.today.clone().add(minutes, 'minutes');
		if (minutes < ctx.boundary) at.add(1, 'day');
		return { value: at, hasTime: true };
	}
	const withTime = moment(v, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD H:mm'], true);
	if (withTime.isValid()) return { value: withTime, hasTime: true };
	const date = moment(v, 'YYYY-MM-DD', true);
	if (date.isValid()) return { value: date, hasTime: false };
	throw new CliError(`Invalid date and time: ${v}. Use YYYY-MM-DD HH:mm, YYYY-MM-DD, or HH:mm.`);
}

/** フラグの値。なければ（値なしのフラグも）空文字 */
function flagValue(params: CliData, key: string): string {
	const v = params[key];
	return v === undefined || v === 'true' ? '' : v.trim();
}

/**
 * 周期の値を、設定の表記にそろえる（大文字小文字は区別しない）。
 * カンマか読点で区切る。曜日は月曜日からの順に並べる
 */
function parseRepeat(value: string, ctx: TaskContext): string[] {
	const known = [ctx.everyday, ctx.workday, ctx.holiday, ...ctx.weekdays];
	const picked = new Set<string>();
	for (const raw of value.split(/[,、]/)) {
		const v = raw.trim().toLowerCase();
		if (v === '') continue;
		const match = known.find((k) => k.toLowerCase() === v);
		if (match === undefined) throw new CliError(`Unknown repeat value: ${raw.trim()}. Use ${known.join(', ')}.`);
		picked.add(match);
	}
	return known.filter((k) => picked.has(k));
}

/** タスクのノートを保管庫の直下に作る。入力をすべて確かめてから作る（途中で失敗しても、ノートを残さない） */
async function createTask(plugin: DailyLoggingPlugin, params: CliData): Promise<string> {
	const { app } = plugin;
	const ctx = plugin.taskContext();
	const names = plugin.taskPropNames();

	const name = flagValue(params, 'name');
	if (name === '') throw new CliError('Enter a note name with name=<text>.');
	// ファイル名に使えない文字と、リンクを壊す文字
	if (/[\\/:*?"<>|#^[\]]/.test(name)) throw new CliError(`The name can't contain \\ / : * ? " < > | # ^ [ ].`);
	const path = normalizePath(`${name}.md`);
	if (app.vault.getAbstractFileByPath(path) || app.metadataCache.getFirstLinkpathDest(name, '')) {
		throw new CliError(`A note named ${name} already exists.`);
	}

	// 書くプロパティ（書く順）。出力にも同じ順で出す
	const props: [string, unknown, string][] = [];
	const repeatValue = flagValue(params, 'repeat');
	const atValue = flagValue(params, 'at');
	if (repeatValue === '' && atValue === '') {
		throw new CliError('Add repeat=<days> for a repeating task, or at=<YYYY-MM-DD HH:mm> for a one-time task.');
	}
	if (repeatValue !== '') {
		const repeat = parseRepeat(repeatValue, ctx);
		if (repeat.length === 0) throw new CliError('Enter repeat values with repeat=<days>.');
		props.push([names.cycle, repeat, repeat.join(', ')]);
	}
	const section = flagValue(params, 'section');
	if (section !== '') {
		const tags = ctx.slots.map((s) => s.tag).filter((t) => t !== '');
		const match = tags.find((t) => t.toLowerCase() === section.toLowerCase());
		if (match === undefined) {
			throw new CliError(
				tags.length > 0 ? `Unknown section: ${section}. Use ${tags.join(', ')}.` : 'No time slot has a tag.',
			);
		}
		props.push([names.section, match, match]);
	}
	if (atValue !== '') {
		const at = parseAt(atValue, ctx);
		const text = at.value.format(at.hasTime ? PROP_DATE_FORMAT : PROP_DAY_FORMAT);
		props.push([names.scheduled, text, text]);
	}
	const timeValue = flagValue(params, 'time');
	if (timeValue !== '') {
		const minutes = parseTime(timeValue);
		if (minutes === null) throw new CliError(`Invalid time: ${timeValue}. Use HH:mm.`);
		const text = moment().startOf('day').add(minutes, 'minutes').format('HH:mm');
		props.push([names.time, text, text]);
	}
	const tag = flagValue(params, 'tag').replace(/^#/, '');
	if (tag !== '') props.push([names.tag, [tag], tag]);
	const estimateValue = flagValue(params, 'estimate');
	if (estimateValue !== '') {
		const estimate = Number(estimateValue);
		if (!Number.isFinite(estimate) || estimate <= 0) {
			throw new CliError(`Invalid estimate: ${estimateValue}. Use a number of minutes.`);
		}
		props.push([names.estimate, estimate, String(estimate)]);
	}
	const location = flagValue(params, 'location');
	if (location !== '') props.push([names.location, location, location]);

	const title = flagValue(params, 'title');
	const heading = plugin.settings.titleHeading.trim();
	if (title !== '' && heading === '') throw new CliError('Set the title heading in the settings to use title=.');
	const body = title !== '' ? `## ${heading}\n- [ ] ${title}\n` : '';

	const file = await app.vault.create(path, body);
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		for (const [key, value] of props) fm[key] = value;
	});
	const lines = [`Created ${file.path}.`, ...props.map(([key, , text]) => `${key}: ${text}`)];
	if (title !== '') lines.push(`${heading}: ${title}`);
	return lines.join('\n');
}

/** デイリーノートが使えなければ、通知ではなくエラーで返す */
function requireDailyNotes(plugin: DailyLoggingPlugin): void {
	if (!getDailyNotes(plugin.app)) throw new CliError(NO_DAILY_NOTES_MESSAGE);
}

/** file= か path= で指定したファイル。どちらもなければアクティブなファイル */
function targetFile(plugin: DailyLoggingPlugin, params: CliData): TFile {
	const { app } = plugin;
	let file: TFile | null;
	if (params.path && params.path !== 'true') {
		file = app.vault.getFileByPath(normalizePath(params.path));
		if (!file) throw new CliError(`File not found: ${params.path}`);
	} else if (params.file && params.file !== 'true') {
		file = app.metadataCache.getFirstLinkpathDest(params.file, '');
		if (!file) throw new CliError(`File not found: ${params.file}`);
	} else {
		file = app.workspace.getActiveFile();
		if (!file) throw new CliError('No file is open. Use file=<name> or path=<path>.');
	}
	return file;
}

/** 記録した行。記録できなかったらエラー（理由は通知と開発者コンソールに出ている） */
function loggedText(logged: LoggedLine | null): string {
	if (!logged) throw new CliError("Couldn't log the entry. See the notice in Obsidian.");
	return logged.text;
}

function linkLines(links: { text: string }[]): string[] {
	return links.length > 0 ? ['Links:', ...links.map((l) => `- ${l.text}`)] : [];
}

/** 今日のタスク一覧 */
async function listTasks(plugin: DailyLoggingPlugin, json: boolean): Promise<string> {
	const ctx = plugin.taskContext();
	const now = moment();
	const entries = await plugin.orderedTasks(ctx);
	const slot = currentSlot(ctx, now);
	const groupTitle = (group: number) => {
		const labels = plugin.taskLabels();
		if (group === GROUP_RUNNING) return labels.running;
		if (group === GROUP_SKIPPED) return labels.skipped;
		if (group === GROUP_OTHER) return labels.other;
		return ctx.slots[group]?.heading ?? labels.other;
	};
	const end = slot !== null ? slotEnd(ctx, slot) : null;
	const remaining = end ? formatDuration(now, end) : null;
	const available = getDailyNotes(plugin.app) !== null;

	const rows = entries.map((e) => ({
		group: groupTitle(e.group),
		current: e.group === slot,
		name: e.name,
		path: e.file.path,
		time: timeOf(e, ctx),
		running: isRunning(e.props),
		elapsed: elapsedOf(e, now),
		estimate: e.props.estimate,
		tag: e.props.tag || null,
	}));

	if (json) {
		return JSON.stringify(
			{
				today: ctx.today.format('YYYY-MM-DD'),
				currentSlot: slot !== null ? groupTitle(slot) : null,
				remaining,
				dailyNotesAvailable: available,
				tasks: rows,
			},
			null,
			2,
		);
	}

	const lines: string[] = [];
	if (!available) lines.push(`Warning: ${NO_DAILY_NOTES_MESSAGE}`);
	const current = slot !== null ? `, current time slot: ${groupTitle(slot)} (${remaining ?? ''} left)` : '';
	lines.push(`Today: ${ctx.today.format('YYYY-MM-DD')}${current}`);
	if (rows.length === 0) lines.push('No tasks.');
	let last: string | null = null;
	for (const row of rows) {
		if (row.group !== last) {
			const count = rows.filter((r) => r.group === row.group).length;
			lines.push('', `## ${row.group} (${count})${row.current ? ' [current]' : ''}`);
			last = row.group;
		}
		const fields = [`path=${row.path}`];
		if (row.running) fields.push(`running=${row.elapsed ?? ''}`);
		if (row.estimate !== null) fields.push(`estimate=${row.estimate}`);
		if (row.tag) fields.push(`tag=${row.tag}`);
		lines.push(`- ${row.time ? `${row.time} ` : ''}${row.name} | ${fields.join(' | ')}`);
	}
	return lines.join('\n');
}

/**
 * 一度も開始していないタスク。保管庫の直下の Markdown で、周期か予定日時のプロパティがあり（値は空でもよい）、
 * 開始日時が空のもの（プロパティがなくてもよい）。デイリーノートと休日のノートは除く。名前の順
 */
async function listUnstarted(plugin: DailyLoggingPlugin, json: boolean): Promise<string> {
	const { app } = plugin;
	const names = plugin.taskPropNames();
	const dn = getDailyNotes(app);
	const holidayNote = plugin.holidayNote();
	const has = (fm: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(fm, key);
	const isEmpty = (v: unknown) =>
		v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
	// 値はプロパティの書かれたとおりに出す（空なら null）
	const valueOf = (v: unknown) => (isEmpty(v) ? null : Array.isArray(v) ? v.map(String).join(', ') : String(v));

	const files = app.vault
		.getMarkdownFiles()
		.filter((f) => f.parent?.isRoot() && f !== holidayNote && !(dn && isDailyNote(f, dn)))
		.sort((a, b) => a.basename.localeCompare(b.basename));
	const days = plugin.weekdays();
	const rows = [];
	for (const file of files) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm || !(has(fm, names.cycle) || has(fm, names.scheduled)) || !isEmpty(fm[names.start])) continue;
		rows.push({
			name: (await plugin.readTitle(file, undefined, days)) ?? file.basename,
			path: file.path,
			repeat: valueOf(fm[names.cycle]),
			scheduled: valueOf(fm[names.scheduled]),
		});
	}

	if (json) return JSON.stringify({ tasks: rows }, null, 2);
	if (rows.length === 0) return 'No tasks that have never been started.';
	return rows
		.map((row) => {
			const fields = [`path=${row.path}`];
			if (row.repeat !== null) fields.push(`repeat=${row.repeat}`);
			if (row.scheduled !== null) fields.push(`scheduled=${row.scheduled}`);
			return `- ${row.name} | ${fields.join(' | ')}`;
		})
		.join('\n');
}

/** 予定時刻。今日なら HH:mm、ほかの日なら日付も付ける。時刻がなければ日付だけ（今日なら null） */
function timeOf(e: TaskEntry, ctx: TaskContext): string | null {
	const s = e.scheduled;
	if (!s) return null;
	const today = scheduledDay(s, ctx).isSame(ctx.today, 'day');
	if (today) return s.hasTime ? s.value.format('HH:mm') : null;
	return s.value.format(s.hasTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD');
}

/** 実行中なら開始からの経過時間（開始時刻が分からなければ ??:??）。実行中でなければ null */
function elapsedOf(e: TaskEntry, now: Moment): string | null {
	const start = isRunning(e.props) ? e.props.start : null;
	if (!start) return null;
	return e.props.startKnown ? formatDuration(start, now) : UNKNOWN_TIME;
}
