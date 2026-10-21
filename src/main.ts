import { Plugin, TAbstractFile, TFile, debounce, moment } from 'obsidian';
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
import {
	Moment,
	PROP_DATE_FORMAT,
	TaskContext,
	TaskPropNames,
	formatDuration,
	isRunning,
	readTask,
	shouldClearScheduled,
} from './task';
import { TaskView, VIEW_TYPE_TASKS } from './task-view';

/** 作成から何ミリ秒以内に開かれたら記録するか */
const OPEN_WINDOW_MS = 5000;

export default class DailyLoggingPlugin extends Plugin {
	settings!: DailyLoggingSettings;

	/** 追記を1件ずつ順番に処理するためのキュー */
	private queue: Promise<void> = Promise.resolve();

	/** 作成されたが、まだ開かれていないファイル（パス → 作成時刻） */
	private pending = new Map<string, Moment>();

	/** 開いているタスク一覧をすべて描き直す（設定の入力中は何度も呼ばれるので、まとめて行う） */
	requestTaskViewRefresh = debounce(
		() => {
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS)) {
				if (leaf.view instanceof TaskView) leaf.view.render();
			}
		},
		300,
		true,
	);

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new DailyLoggingSettingTab(this.app, this));
		this.registerView(VIEW_TYPE_TASKS, (leaf) => new TaskView(leaf, this));
		this.addRibbonIcon('list-checks', 'Open task list', () => {
			void this.activateTaskView();
		});
		this.addCommand({
			id: 'open-task-list',
			name: 'Open task list',
			callback: () => {
				void this.activateTaskView();
			},
		});
		this.addCommand({
			id: 'start-task',
			name: 'Start task',
			checkCallback: (checking) => this.taskCommand(checking, false, (f) => this.startTask(f)),
		});
		this.addCommand({
			id: 'end-task',
			name: 'End task',
			checkCallback: (checking) => this.taskCommand(checking, true, (f) => this.endTask(f)),
		});
		this.addCommand({
			id: 'interrupt-task',
			name: 'Interrupt task',
			checkCallback: (checking) => this.taskCommand(checking, true, (f) => this.interruptTask(f)),
		});

		// Vault の読み込み時には、既存のすべてのファイルについて create が発生するため、
		// レイアウトの準備が終わってから登録する
		this.app.workspace.onLayoutReady(() => {
			const { vault, workspace } = this.app;
			this.registerEvent(vault.on('create', (file) => this.handleCreate(file)));
			this.registerEvent(workspace.on('file-open', (file) => this.handleOpen(file)));
			this.registerEvent(
				vault.on('rename', (file, oldPath) => this.handleRename(file, oldPath)),
			);
			this.registerEvent(vault.on('delete', (file) => this.pending.delete(file.path)));
		});
	}

	/** 作成されたファイルを控えておく。記録は開かれたときに行う */
	private handleCreate(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		if (!parseExtensions(this.settings.extensions).has(file.extension.toLowerCase())) return;

		this.prunePending();
		this.pending.set(file.path, moment()); // 記録する時刻は作成時刻
	}

	/**
	 * 作成から一定時間内にこの端末で開かれたファイルだけを記録する。
	 * Git の pull などで入ってきたファイルは開かれないので、記録されない。
	 */
	private handleOpen(file: TFile | null): void {
		if (!file) return;
		const createdAt = this.pending.get(file.path);
		if (!createdAt) return;
		this.pending.delete(file.path);
		if (moment().diff(createdAt) > OPEN_WINDOW_MS) return;

		this.logEntry(file, createdAt);
	}

	/** 開かれる前に改名されたら、控えのパスも変える */
	private handleRename(file: TAbstractFile, oldPath: string): void {
		const createdAt = this.pending.get(oldPath);
		if (!createdAt) return;
		this.pending.delete(oldPath);
		this.pending.set(file.path, createdAt);
	}

	/** 時間切れの控えを消す（pull で大量に作られた場合に溜まらないように） */
	private prunePending(): void {
		const now = moment();
		for (const [path, at] of this.pending) {
			if (now.diff(at) > OPEN_WINDOW_MS) this.pending.delete(path);
		}
	}

	/** デイリーノートの、時刻に合う場所に1行記録する（キューで順番に処理） */
	private logEntry(file: TFile, at: Moment, suffix = ''): void {
		this.enqueue(async () => {
			const dn = getDailyNotes(this.app);
			if (!dn) return; // デイリーノートが無効
			if (isDailyNote(file, dn)) return; // デイリーノート自身は対象外
			if (!this.app.vault.getFileByPath(file.path)) return; // 処理を待つ間に削除された

			const { useHeadings, headingRule, logToPreviousDay, timeSlots } = this.settings;
			const slots = useHeadings ? parseTimeSlots(timeSlots).slots : [];
			const { date, slot } = resolvePlacement(at, slots, logToPreviousDay);

			await updateDailyNote(this.app, dn, date, (data, dailyNote) => {
				const link = this.app.fileManager.generateMarkdownLink(file, dailyNote.path);
				const line = `- ${at.format('HH:mm')} ${link}${suffix}`;
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

	/** タスクを開始する。開始日時を書き込み、デイリーノートに記録する */
	async startTask(file: TFile): Promise<void> {
		const now = moment();
		const names = this.taskPropNames();
		const updated = this.waitForMetadata(file); // 書き換えより前に待ち始める

		// フロントマターがなければ、processFrontMatter が作る
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[names.start] = now.format(PROP_DATE_FORMAT);
			// 前回の終了日時は値だけ空にする（同じ分に終了・開始しても実行中と判定できるように）
			if (names.end in fm) fm[names.end] = null;
		});
		this.logEntry(file, now, ` ${this.taskLabels().start}`);
		await updated;
	}

	/** タスクを終了する。今日以前の予定日時は値だけ空にする */
	async endTask(file: TFile): Promise<void> {
		await this.finishTask(file, 'end');
	}

	/** タスクを中断する。再開の見込み時刻を予定日時に入れて、一覧に残す */
	async interruptTask(file: TFile): Promise<void> {
		await this.finishTask(file, 'interrupt');
	}

	/** 終了と中断の共通処理。終了日時を書き込み、所要時間付きで記録する */
	private async finishTask(file: TFile, mode: 'end' | 'interrupt'): Promise<void> {
		const now = moment();
		const names = this.taskPropNames();
		const ctx = this.taskContext();
		const before: { start: Moment | null } = { start: null };
		const updated = this.waitForMetadata(file);

		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const props = readTask(fm, names);
			before.start = props?.start ?? null;
			fm[names.end] = now.format(PROP_DATE_FORMAT);

			if (mode === 'end') {
				if (props && shouldClearScheduled(props, ctx)) fm[names.scheduled] = null; // 値だけ空にする
			} else {
				// 一定時間後に再開する見込みとして、予定日時を入れる（日付をまたいでもよい）
				const resumeAt = now.clone().add(this.resumeMinutes(), 'minutes');
				fm[names.scheduled] = resumeAt.format(PROP_DATE_FORMAT);
			}
		});

		const labels = this.taskLabels();
		const label = mode === 'end' ? labels.end : labels.interrupt;
		const duration = before.start ? ` (${formatDuration(before.start, now)})` : '';
		this.logEntry(file, now, ` ${label}${duration}`);
		await updated;
	}

	/**
	 * 開いているファイルが条件に合うときだけコマンドを実行する（checkCallback 用）。
	 * Markdown で、デイリーノートでなく、実行中かどうかが needRunning と一致するとき。
	 * プロパティがないファイルは「実行中でない」とみなすので、開始できる。
	 */
	private taskCommand(
		checking: boolean,
		needRunning: boolean,
		run: (file: TFile) => Promise<void>,
	): boolean {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') return false;

		const dn = getDailyNotes(this.app);
		if (!dn || isDailyNote(file, dn)) return false; // デイリーノートが無効なら記録できない

		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const props = readTask(fm, this.taskPropNames());
		const running = props !== null && isRunning(props);
		if (running !== needRunning) return false;

		if (!checking) {
			void run(file).catch((err: unknown) => console.error('[Daily Logging]', err));
		}
		return true;
	}

	/** そのファイルの metadataCache が更新されるのを待つ（一定時間で打ち切る） */
	private waitForMetadata(file: TFile, timeout = 2000): Promise<void> {
		return new Promise((resolve) => {
			const cache = this.app.metadataCache;
			const finish = () => {
				cache.offref(ref);
				window.clearTimeout(timer);
				resolve();
			};
			const ref = cache.on('changed', (changed) => {
				if (changed.path === file.path) finish();
			});
			const timer = window.setTimeout(finish, timeout);
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

	/** 記録、ボタン、グループ名に使う文字（空欄なら既定値） */
	taskLabels(): { start: string; end: string; interrupt: string; running: string; other: string } {
		const s = this.settings;
		const d = DEFAULT_SETTINGS;
		const pick = (v: string, fallback: string) => v.trim() || fallback;
		return {
			start: pick(s.startLabel, d.startLabel),
			end: pick(s.endLabel, d.endLabel),
			interrupt: pick(s.interruptLabel, d.interruptLabel),
			running: pick(s.runningGroupLabel, d.runningGroupLabel),
			other: pick(s.otherGroupLabel, d.otherGroupLabel),
		};
	}

	/** 中断から再開までの見込み（分）。不正な値なら既定値 */
	resumeMinutes(): number {
		const value = this.settings.resumeMinutes.trim();
		const fallback = Number(DEFAULT_SETTINGS.resumeMinutes);
		return /^\d+$/.test(value) ? Number(value) : fallback;
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
