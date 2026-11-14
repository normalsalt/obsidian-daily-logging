import { PluginSettingTab, getIconIds } from 'obsidian';
import type { App, SettingDefinitionItem } from 'obsidian';
import { parseTime, parseTimeSlots } from './time-slots';
import type DailyLoggingPlugin from './main';

export interface DailyLoggingSettings {
	/** 記録する拡張子（カンマ区切り） */
	extensions: string;
	/** 記録した行の下に、1段インデントした空のバレットを入れる */
	childBullet: boolean;
	/** デイリーノートを開いたら、カーソルをファイルの末尾に置く */
	cursorToEnd: boolean;
	/** 時間帯の見出しの下に追記する */
	useHeadings: boolean;
	/** 新しく作る見出しの下に区切り線（---）を入れる */
	headingRule: boolean;
	/** 最初の時間帯より前は、前日の最後の時間帯に追記する */
	logToPreviousDay: boolean;
	/** 「時刻 | 見出し | タグ」を1行に1つ */
	timeSlots: string;
	/** その日の終了時刻（HH:mm）。空なら翌日の最初の時間帯 */
	dayEnd: string;

	/** タスクのプロパティ名 */
	cycleProp: string;
	sectionProp: string;
	/** タスク一覧で、グループの中をまとめるタグのリストプロパティ名 */
	tagProp: string;
	scheduledProp: string;
	startProp: string;
	endProp: string;
	/** 予定時刻（HH:mm のテキスト）のプロパティ名 */
	timeProp: string;
	/** スキップ日時のプロパティ名 */
	skipProp: string;
	/** repeat の値の表記 */
	everydayValue: string;
	/** 月曜日〜日曜日の表記（カンマ区切りで7つ） */
	weekdayValues: string;
	/** 平日・休日の表記 */
	workdayValue: string;
	holidayValue: string;
	/** 予定日時が今日なら休日とするノートの名前 */
	holidayNote: string;
	/** 中断してから再開するまでの見込み（分） */
	resumeMinutes: string;
	/** タスク一覧で、この見出しの下の一番上の未チェックのチェックボックスを、ファイル名の代わりに出す。空ならしない */
	titleHeading: string;
	/** 開始時に、タスクのノートのこの見出しの下の未チェックのチェックボックスをコピーする。空ならしない */
	stepsHeading: string;
	/** スキップしたら、デイリーノートに記録する */
	logSkip: boolean;
	/** タスクを記録したら、デイリーノートの追記した行を表示する */
	openDailyNote: boolean;
	/** タスクを開始したら、場所のプロパティの URL と内部リンクをモーダルで出す */
	showLinksOnStart: boolean;

	/** タスク一覧のボタンに、アイコンの右に文字も出す */
	showButtonText: boolean;
	/** タスク一覧にスキップボタンを出す（一覧の上部のボタンで切り替える。設定画面には出さない） */
	showSkipButtons: boolean;
	/** タスク一覧で閉じているグループの名前（見出しを押して切り替える。設定画面には出さない） */
	collapsedGroups: string[];
	/** ボタンのアイコン（組み込みアイコンの名前）。空ならアイコンなし */
	startIcon: string;
	skipIcon: string;
	interruptIcon: string;
	endIcon: string;

	/** デイリーノートの記録とボタンに使う言葉 */
	createLabel: string;
	startLabel: string;
	endLabel: string;
	interruptLabel: string;
	skipLabel: string;
	doneLabel: string;
	/** タスク一覧のグループ名 */
	runningGroupLabel: string;
	otherGroupLabel: string;

	/** 予定を返す GAS ウェブアプリの URL */
	calendarUrl: string;
	/** トークンの SecretStorage のキー（値そのものではない） */
	calendarToken: string;
	/** 予定の場所を書くプロパティ名 */
	locationProp: string;
}

export const DEFAULT_SETTINGS: DailyLoggingSettings = {
	extensions: 'md',
	childBullet: true,
	cursorToEnd: true,
	useHeadings: true,
	headingRule: true,
	logToPreviousDay: true,
	timeSlots: [
		'6:00 | Morning routine | morning',
		'9:00 | Warm-up | pre',
		'13:00 | Main work | grand',
		'17:00 | Evening routine | evening',
		'21:00 | Night routine | night',
	].join('\n'),
	dayEnd: '',

	cycleProp: 'repeat',
	sectionProp: 'section',
	tagProp: 'tags',
	scheduledProp: 'scheduled',
	startProp: 'started',
	endProp: 'ended',
	timeProp: 'time',
	skipProp: 'skipped',
	everydayValue: 'Every day',
	weekdayValues: 'Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday',
	workdayValue: 'Workday',
	holidayValue: 'Holiday',
	holidayNote: '',
	resumeMinutes: '15',
	titleHeading: 'Tasks',
	stepsHeading: 'Steps',
	logSkip: true,
	openDailyNote: true,
	showLinksOnStart: true,

	showButtonText: true,
	showSkipButtons: true,
	collapsedGroups: [],
	startIcon: 'play',
	skipIcon: 'skip-forward',
	interruptIcon: 'pause',
	endIcon: 'check',

	createLabel: 'created',
	startLabel: 'started',
	endLabel: 'ended',
	interruptLabel: 'interrupted',
	skipLabel: 'skipped',
	doneLabel: 'done',
	runningGroupLabel: 'Running',
	otherGroupLabel: 'Other',

	calendarUrl: '',
	calendarToken: '',
	locationProp: 'location',
};

/** "md, .Canvas  pdf" → Set { 'md', 'canvas', 'pdf' } */
export function parseExtensions(value: string): Set<string> {
	return new Set(
		value
			.split(/[\s,]+/)
			.map((ext) => ext.trim().replace(/^\.+/, '').toLowerCase())
			.filter((ext) => ext !== ''),
	);
}

/** 組み込みアイコンの名前か（「lucide-」を付けずに書いてもよい） */
export function isIconId(value: string): boolean {
	const v = value.trim();
	if (v === '') return false;
	const ids = getIconIds();
	return ids.includes(v) || ids.includes(`lucide-${v}`);
}

/** 曜日の表記を月曜日から順に返す。7つでなければ null */
export function parseWeekdays(value: string): string[] | null {
	const days = value
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s !== '');
	return days.length === 7 ? days : null;
}

export class DailyLoggingSettingTab extends PluginSettingTab {
	plugin: DailyLoggingPlugin;

	constructor(app: App, plugin: DailyLoggingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** 設定の変更を保存し、タスク一覧に反映する */
	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
		this.plugin.requestTaskViewRefresh();
	}

	getSettingDefinitions(): SettingDefinitionItem<keyof DailyLoggingSettings>[] {
		const d = DEFAULT_SETTINGS;
		const headingsOn = () => this.plugin.settings.useHeadings;
		const iconDesc = 'Name of a built-in icon, such as play. Leave empty for no icon.';
		const validateIcon = (value: string) =>
			value.trim() === '' || isIconId(value) ? '' : 'Unknown icon name.';

		return [
			// 全般（見出しなし）
			{
				name: 'File extensions',
				desc: 'Comma-separated list of file extensions to log when a file is created, for example: md, canvas, base',
				control: { type: 'text', key: 'extensions', placeholder: 'md' },
			},
			{
				name: 'Add a bullet under each entry',
				desc: 'Add an empty bullet, indented one level, on the line after each entry. After a task is logged, the cursor moves to it. If you leave it empty, it is removed when the next entry is added.',
				control: { type: 'toggle', key: 'childBullet' },
			},
			{
				name: 'Move the cursor to the end of daily notes',
				desc: 'When you open a daily note, move the cursor to the end of the note, unless a link to a heading or block opened it.',
				control: { type: 'toggle', key: 'cursorToEnd' },
			},
			{
				type: 'group',
				heading: 'Time slots',
				items: [
					{
						name: 'Group entries by time slot',
						desc: 'Add each entry under the heading of its time slot.',
						control: { type: 'toggle', key: 'useHeadings' },
					},
					{
						name: 'Add a horizontal rule under new headings',
						desc: 'Insert "---" on the line after each heading this plugin creates.',
						visible: headingsOn,
						control: { type: 'toggle', key: 'headingRule' },
					},
					{
						name: 'Log early entries to the previous day',
						desc: 'Entries before the first time slot go under the last slot of the previous day.',
						visible: headingsOn,
						control: { type: 'toggle', key: 'logToPreviousDay' },
					},
					{
						name: 'Time slots',
						desc: 'One slot per line: time | heading | tag',
						visible: headingsOn,
						control: {
							type: 'textarea',
							key: 'timeSlots',
							rows: 6,
							validate: (value) => parseTimeSlots(value).errors.join(' '),
						},
					},
					{
						name: 'End of the day',
						desc: 'When the last time slot ends, for the remaining time in the task list. Leave empty to use the first time slot of the next day.',
						visible: headingsOn,
						control: {
							type: 'text',
							key: 'dayEnd',
							placeholder: '23:00',
							validate: (value) =>
								value.trim() === '' || parseTime(value) !== null
									? ''
									: 'Enter a time such as 23:00, or leave it empty.',
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Tasks',
				items: [
					{
						name: 'Resume after interruption',
						desc: 'Minutes from an interruption to the scheduled time for resuming the task.',
						control: {
							type: 'text',
							key: 'resumeMinutes',
							placeholder: d.resumeMinutes,
							validate: (value) =>
								/^\s*\d+\s*$/.test(value) ? '' : 'Enter a whole number of minutes.',
						},
					},
					{
						name: 'Title heading',
						desc: "In the task list, show the first unchecked checkbox under this heading in the task's note, instead of the file name. Leave empty to always show the file name.",
						control: { type: 'text', key: 'titleHeading', placeholder: d.titleHeading },
					},
					{
						name: 'Steps heading',
						desc: "When you start a task, the unchecked checkboxes under this heading in the task's note are copied under the entry, instead of an empty bullet. Leave empty to turn off.",
						control: { type: 'text', key: 'stepsHeading', placeholder: d.stepsHeading },
					},
					{
						name: 'Log skipped tasks',
						desc: 'When you skip a task, log it to the daily note, so you can write the reason under it. The skip property is set either way.',
						control: { type: 'toggle', key: 'logSkip' },
					},
					{
						name: 'Show the logged line',
						desc: 'After you start, interrupt, end, or skip a task, open the daily note and move the cursor to the new line, or to the bullet under it.',
						control: { type: 'toggle', key: 'openDailyNote' },
					},
					{
						name: 'Show links when a task starts',
						desc: 'When you start a task whose location property has a URL or an internal link, show it in a popup so you can open it right away.',
						control: { type: 'toggle', key: 'showLinksOnStart' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Task properties',
				items: [
					{
						name: 'Repeat property',
						desc: 'List property that holds the days a task appears in the sidebar.',
						control: { type: 'text', key: 'cycleProp', placeholder: d.cycleProp },
					},
					{
						name: 'Section property',
						desc: 'Text property that holds the tag of a time slot.',
						control: { type: 'text', key: 'sectionProp', placeholder: d.sectionProp },
					},
					{
						name: 'Tag property',
						desc: 'List property. Tasks whose first value is the same are grouped together within a time slot in the task list.',
						control: { type: 'text', key: 'tagProp', placeholder: d.tagProp },
					},
					{
						name: 'Scheduled property',
						desc: 'Date & time property. Cleared when a task is finished, set to a later time when it is interrupted.',
						control: { type: 'text', key: 'scheduledProp', placeholder: d.scheduledProp },
					},
					{
						name: 'Time property',
						desc: 'Text property that holds a time of day, such as 18:00. Used like the scheduled time when the scheduled property is empty.',
						control: { type: 'text', key: 'timeProp', placeholder: d.timeProp },
					},
					{
						name: 'Skip property',
						desc: 'Date & time property set when a task is skipped. If it is today, the task is hidden from the sidebar for the day, unless it is running.',
						control: { type: 'text', key: 'skipProp', placeholder: d.skipProp },
					},
					{
						name: 'Start property',
						desc: 'Date & time property set when a task is started.',
						control: { type: 'text', key: 'startProp', placeholder: d.startProp },
					},
					{
						name: 'End property',
						desc: 'Date & time property set when a task is finished.',
						control: { type: 'text', key: 'endProp', placeholder: d.endProp },
					},
					{
						name: 'Location property',
						desc: 'Text property that holds the location of an event. Its URLs and links are shown when the task starts.',
						control: { type: 'text', key: 'locationProp', placeholder: d.locationProp },
					},
				],
			},
			{
				type: 'group',
				heading: 'Repeat values',
				items: [
					{
						name: 'Every day value',
						desc: 'Repeat value that matches every day.',
						control: { type: 'text', key: 'everydayValue', placeholder: d.everydayValue },
					},
					{
						name: 'Weekday values',
						desc: 'Comma-separated repeat values from Monday to Sunday.',
						control: {
							type: 'text',
							key: 'weekdayValues',
							placeholder: d.weekdayValues,
							validate: (value) =>
								parseWeekdays(value) ? '' : 'Enter exactly 7 values, from Monday to Sunday.',
						},
					},
					{
						name: 'Workday value',
						desc: "Repeat value that matches days that aren't holidays.",
						control: { type: 'text', key: 'workdayValue', placeholder: d.workdayValue },
					},
					{
						name: 'Holiday value',
						desc: 'Repeat value that matches holidays.',
						control: { type: 'text', key: 'holidayValue', placeholder: d.holidayValue },
					},
					{
						name: 'Holiday note',
						desc: 'Name of the note whose scheduled date marks today as a holiday. Leave empty to treat every day as a workday.',
						control: { type: 'text', key: 'holidayNote' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Buttons',
				items: [
					{
						name: 'Show text on buttons',
						desc: 'Show the label to the right of the icon on the buttons in the task list. Buttons without an icon always show the label.',
						control: { type: 'toggle', key: 'showButtonText' },
					},
					{
						name: 'Start icon',
						desc: iconDesc,
						control: { type: 'text', key: 'startIcon', validate: validateIcon },
					},
					{
						name: 'Skip icon',
						desc: iconDesc,
						control: { type: 'text', key: 'skipIcon', validate: validateIcon },
					},
					{
						name: 'Interrupt icon',
						desc: iconDesc,
						control: { type: 'text', key: 'interruptIcon', validate: validateIcon },
					},
					{
						name: 'End icon',
						desc: iconDesc,
						control: { type: 'text', key: 'endIcon', validate: validateIcon },
					},
				],
			},
			{
				type: 'group',
				heading: 'Labels',
				items: [
					{
						name: 'Create label',
						desc: 'Word written after the link when a new file is logged.',
						control: { type: 'text', key: 'createLabel', placeholder: d.createLabel },
					},
					{
						name: 'Start label',
						desc: 'Word written after the link when a task is started, and on its button.',
						control: { type: 'text', key: 'startLabel', placeholder: d.startLabel },
					},
					{
						name: 'End label',
						desc: 'Word written after the link when a task is finished, and on its button.',
						control: { type: 'text', key: 'endLabel', placeholder: d.endLabel },
					},
					{
						name: 'Interrupt label',
						desc: 'Word written after the link when a task is interrupted, and on its button.',
						control: { type: 'text', key: 'interruptLabel', placeholder: d.interruptLabel },
					},
					{
						name: 'Skip label',
						desc: 'Word written after the link when a task is skipped, and on its button.',
						control: { type: 'text', key: 'skipLabel', placeholder: d.skipLabel },
					},
					{
						name: 'Done label',
						desc: 'Word written after the link when a task is marked as already done.',
						control: { type: 'text', key: 'doneLabel', placeholder: d.doneLabel },
					},
					{
						name: 'Running group name',
						desc: 'Group name for running tasks in the task list.',
						control: { type: 'text', key: 'runningGroupLabel', placeholder: d.runningGroupLabel },
					},
					{
						name: 'Other group name',
						desc: 'Group name for tasks that match no time slot.',
						control: { type: 'text', key: 'otherGroupLabel', placeholder: d.otherGroupLabel },
					},
				],
			},
			{
				type: 'group',
				heading: 'Calendar',
				items: [
					{
						name: 'Web app URL',
						desc: 'URL of the Google Apps Script web app that returns calendar events. Leave empty to turn off.',
						control: { type: 'text', key: 'calendarUrl', placeholder: 'https://script.google.com/macros/s/.../exec' },
					},
					{
						name: 'Token',
						desc: 'Secret that holds the token for the web app.',
						control: { type: 'secret', key: 'calendarToken' },
					},
				],
			},
		];
	}
}
