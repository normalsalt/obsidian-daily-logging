import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import DailyLoggingPlugin from './main';
import { parseTimeSlots } from './time-slots';

export interface DailyLoggingSettings {
	extensions: string;
	useHeadings: boolean;
	headingRule: boolean;
	logToPreviousDay: boolean;
	timeSlots: string;
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

export class DailyLoggingSettingTab extends PluginSettingTab {
	plugin: DailyLoggingPlugin;

	constructor(app: App, plugin: DailyLoggingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem<keyof DailyLoggingSettings>[] {
		return [
			{
				name: 'File extensions',
				desc: 'Comma-separated list of file extensions to log when a file is created, for example: md, canvas, base',
				control: { type: 'text', key: 'extensions', placeholder: 'md' },
			},
			{
				name: 'Group entries by time slot',
				desc: 'Add each entry under the heading of its time slot.',
				control: { type: 'toggle', key: 'useHeadings' },
			},
			{
				name: 'Add a horizontal rule under new headings',
				desc: 'Insert "---" on the line after each heading this plugin creates.',
				visible: () => this.plugin.settings.useHeadings,
				control: { type: 'toggle', key: 'headingRule' },
			},
			{
				name: 'Log early entries to the previous day',
				desc: 'Entries before the first time slot go under the last slot of the previous day.',
				visible: () => this.plugin.settings.useHeadings,
				control: { type: 'toggle', key: 'logToPreviousDay' },
			},
			{
				name: 'Time slots',
				desc: 'One slot per line: time | heading | tag',
				visible: () => this.plugin.settings.useHeadings,
				control: {
					type: 'textarea',
					key: 'timeSlots',
					rows: 6,
					validate: (value) => parseTimeSlots(value).errors.join(' '),
				},
			},
		];
	}
}
