import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import DailyLoggingPlugin from './main';
import { parseTimeSlots } from './time-slots';

export interface DailyLoggingSettings {
	/** 記録する拡張子（カンマ区切り） */
	extensions: string;
	/** 時間帯の見出しの下に追記する */
	useHeadings: boolean;
	/** 新しく作る見出しの下に区切り線（---）を入れる */
	headingRule: boolean;
	/** 最初の時間帯より前は、前日の最後の時間帯に追記する */
	logToPreviousDay: boolean;
	/** 「時刻 | 見出し | タグ」を1行に1つ */
	timeSlots: string;

	/** タスクのプロパティ名 */
	cycleProp: string;
	sectionProp: string;
	scheduledProp: string;
	startProp: string;
	endProp: string;
	/** 周期の値の表記 */
	everydayValue: string;
	/** 月曜日〜日曜日の表記（カンマ区切りで7つ） */
	weekdayValues: string;

	/** デイリーノートの記録とボタンに使う言葉 */
	startLabel: string;
	endLabel: string;
	/** タスク一覧のグループ名 */
	runningGroupLabel: string;
	otherGroupLabel: string;
}

export const DEFAULT_SETTINGS: DailyLoggingSettings = {
	extensions: 'md',
	useHeadings: true,
	headingRule: true,
	logToPreviousDay: true,
	timeSlots: [
		'6:00 | モーニング・ルーティーン | morning',
		'9:00 | プレ着手 | pre',
		'13:00 | グランド着手 | grand',
		'17:00 | イブニング・ルーティーン | evening',
		'21:00 | ナイト・ルーティーン | night',
	].join('\n'),

	cycleProp: '周期',
	sectionProp: 'セクション',
	scheduledProp: '予定日時',
	startProp: '開始日時',
	endProp: '終了日時',
	everydayValue: '毎日',
	weekdayValues: '月曜日, 火曜日, 水曜日, 木曜日, 金曜日, 土曜日, 日曜日',

	startLabel: '開始',
	endLabel: '終了',
	runningGroupLabel: '実行中',
	otherGroupLabel: 'その他',
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

		return [
			// 全般（見出しなし）
			{
				name: 'File extensions',
				desc: 'Comma-separated list of file extensions to log when a file is created, for example: md, canvas, base',
				control: { type: 'text', key: 'extensions', placeholder: 'md' },
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
				],
			},
			{
				type: 'group',
				heading: 'Tasks',
				items: [
					{
						name: 'Cycle property',
						desc: 'List property that holds the days a task appears in the sidebar.',
						control: { type: 'text', key: 'cycleProp', placeholder: d.cycleProp },
					},
					{
						name: 'Section property',
						desc: 'Text property that holds the tag of a time slot.',
						control: { type: 'text', key: 'sectionProp', placeholder: d.sectionProp },
					},
					{
						name: 'Scheduled property',
						desc: 'Date or date & time property. Cleared when the task is finished.',
						control: { type: 'text', key: 'scheduledProp', placeholder: d.scheduledProp },
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
						name: 'Every day value',
						desc: 'Cycle value that matches every day.',
						control: { type: 'text', key: 'everydayValue', placeholder: d.everydayValue },
					},
					{
						name: 'Weekday values',
						desc: 'Comma-separated cycle values from Monday to Sunday.',
						control: {
							type: 'text',
							key: 'weekdayValues',
							placeholder: d.weekdayValues,
							validate: (value) =>
								parseWeekdays(value) ? '' : 'Enter exactly 7 values, from Monday to Sunday.',
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Labels',
				items: [
					{
						name: 'Start label',
						desc: 'Word written after the link when a task is started.',
						control: { type: 'text', key: 'startLabel', placeholder: d.startLabel },
					},
					{
						name: 'End label',
						desc: 'Word written after the link when a task is finished.',
						control: { type: 'text', key: 'endLabel', placeholder: d.endLabel },
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
		];
	}
}
