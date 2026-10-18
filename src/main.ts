import { Plugin, TAbstractFile, TFile, moment } from 'obsidian';
import { DEFAULT_SETTINGS, DailyLoggingSettings, DailyLoggingSettingTab, parseExtensions } from './settings';
import { appendToDailyNote, getDailyNotes, isDailyNote } from './daily-notes';

export default class DailyLoggingPlugin extends Plugin {
	settings!: DailyLoggingSettings;

	/** 追記を1件ずつ順番に処理するためのキュー */
	private queue: Promise<void> = Promise.resolve();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new DailyLoggingSettingTab(this.app, this));

		// Vault の読み込み時には、既存のすべてのファイルについて create が発生するため、
		// レイアウトの準備が終わってから登録する
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on('create', (file) => this.handleCreate(file)),
			);
		});
	}

	private handleCreate(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		if (!parseExtensions(this.settings.extensions).has(file.extension.toLowerCase())) return;

		const createdAt = moment(); // 処理を待つ間に時刻がずれないよう、ここで記録する

		this.enqueue(async () => {
			const dn = getDailyNotes(this.app);
			if (!dn) return; // デイリーノートが無効
			if (isDailyNote(file, dn)) return; // デイリーノート自身は対象外
			if (!this.app.vault.getFileByPath(file.path)) return; // 処理を待つ間に削除された

			await appendToDailyNote(this.app, dn, createdAt, (dailyNote) => {
				const link = this.app.fileManager.generateMarkdownLink(file, dailyNote.path);
				return `- ${createdAt.format('HH:mm')} ${link}`;
			});
		});
	}

	private enqueue(task: () => Promise<void>): void {
		this.queue = this.queue.then(task).catch((err: unknown) => {
			console.error('[Daily Logging]', err);
		});
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
