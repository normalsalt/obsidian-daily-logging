import {
	App,
	PluginSettingTab,
	SettingDefinitionItem,
} from 'obsidian';
import DailyLoggingPlugin from './main';

export interface DailyLoggingSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: DailyLoggingSettings = {
	mySetting: 'default',
};

export class DailyLoggingSettingTab extends PluginSettingTab {
	plugin: DailyLoggingPlugin;

	constructor(app: App, plugin: DailyLoggingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem<keyof DailyLoggingSettings>[] {
		return [
			{
				name: 'Setting #1',
				control: { type: 'text', key: 'mySetting', placeholder: 'default' },
			},
		];
	}
}
