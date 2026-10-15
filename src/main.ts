import {
	Plugin,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	DailyLoggingSettings,
	DailyLoggingSettingTab,
} from './settings';

export default class DailyLoggingPlugin extends Plugin {
	settings!: DailyLoggingSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new DailyLoggingSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<DailyLoggingSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
