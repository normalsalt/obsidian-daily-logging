import { Plugin, TAbstractFile, TFile, moment } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	DailyLoggingSettings,
	DailyLoggingSettingTab,
	parseExtensions,
	parseWeekdays,
} from './settings';
import { appendLine, getDailyNotes, isDailyNote, updateDailyNote } from './daily-notes';
import {
	dayBoundary,
	insertUnderHeading,
	logicalDate,
	parseTimeSlots,
	resolvePlacement,
} from './time-slots';
import { TaskContext, TaskPropNames } from './task';
import { TaskView, VIEW_TYPE_TASKS } from './task-view';

export default class DailyLoggingPlugin extends Plugin {
	settings!: DailyLoggingSettings;

	/** 追記を1件ずつ順番に処理するためのキュー */
	private queue: Promise<void> = Promise.resolve();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new DailyLoggingSettingTab(this.app, this));
		this.registerView(VIEW_TYPE_TASKS, (leaf) => new TaskView(leaf, this));
		this.addRibbonIcon('list-checks', 'Open task list', () => {
			void this.activateTaskView();
		});

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

			const { useHeadings, headingRule, logToPreviousDay, timeSlots } = this.settings;
			const slots = useHeadings ? parseTimeSlots(timeSlots).slots : [];
			const { date, slot } = resolvePlacement(createdAt, slots, logToPreviousDay);

			await updateDailyNote(this.app, dn, date, (data, dailyNote) => {
				const link = this.app.fileManager.generateMarkdownLink(file, dailyNote.path);
				const line = `- ${createdAt.format('HH:mm')} ${link}`;
				return slot
					? insertUnderHeading(data, slot, slots, line, headingRule)
					: appendLine(data, line);
			});
		});
	}

	private enqueue(task: () => Promise<void>): void {
		this.queue = this.queue.then(task).catch((err: unknown) => {
			console.error('[Daily Logging]', err);
		});
	}

	/** 右サイドバーにタスク一覧を開く（すでにあれば表示する） */
	async activateTaskView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_TASKS)[0];
		if (!leaf) {
			const right = workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: VIEW_TYPE_TASKS, active: true });
			leaf = right;
		}
		await workspace.revealLeaf(leaf);
	}

	/** タスクの判定に使う情報（論理上の今日など） */
	taskContext(): TaskContext {
		const s = this.settings;
		const slots = s.useHeadings ? parseTimeSlots(s.timeSlots).slots : [];
		const boundary = dayBoundary(slots, s.logToPreviousDay);
		return {
			today: logicalDate(moment(), boundary),
			boundary,
			slots,
			toPreviousDay: s.logToPreviousDay,
			everyday: s.everydayValue.trim() || DEFAULT_SETTINGS.everydayValue,
			weekdays:
				parseWeekdays(s.weekdayValues) ?? parseWeekdays(DEFAULT_SETTINGS.weekdayValues) ?? [],
		};
	}

	/** タスクのプロパティ名（空欄なら既定値） */
	taskPropNames(): TaskPropNames {
		const s = this.settings;
		const d = DEFAULT_SETTINGS;
		const pick = (v: string, fallback: string) => v.trim() || fallback;
		return {
			cycle: pick(s.cycleProp, d.cycleProp),
			section: pick(s.sectionProp, d.sectionProp),
			scheduled: pick(s.scheduledProp, d.scheduledProp),
			start: pick(s.startProp, d.startProp),
			end: pick(s.endProp, d.endProp),
		};
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
