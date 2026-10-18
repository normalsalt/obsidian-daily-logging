import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import DailyLoggingPlugin from './main';

export interface DailyLoggingSettings {
	extensions: string;
}

export const DEFAULT_SETTINGS: DailyLoggingSettings = {
	extensions: 'md',
};

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
		];
	}
}
