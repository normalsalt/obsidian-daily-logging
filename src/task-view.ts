import { ItemView, Keymap, TFile, WorkspaceLeaf, debounce, setIcon } from 'obsidian';
import type DailyLoggingPlugin from './main';
import { NO_DAILY_NOTES_MESSAGE, getDailyNotes, isDailyNote, reportError } from './daily-notes';
import {
	GROUP_OTHER,
	GROUP_RUNNING,
	TaskContext,
	TaskProps,
	compareTasks,
	groupOf,
	isRunning,
	isVisible,
	readTask,
	scheduledDay,
} from './task';

export const VIEW_TYPE_TASKS = 'daily-logging-tasks';

interface TaskEntry {
	file: TFile;
	name: string;
	props: TaskProps;
	group: number;
}

export class TaskView extends ItemView {
	plugin: DailyLoggingPlugin;

	/** 一覧を描く場所（上部のボタンは描き直さない） */
	private listEl: HTMLElement | null = null;

	/** 今表示しているタスクのパス（再描画が必要かの判定に使う） */
	private shown = new Set<string>();

	/** 今表示している論理上の日付 */
	private shownDay = '';

	/** 表示したときにデイリーノートが使えたか */
	private shownAvailable = true;

	constructor(leaf: WorkspaceLeaf, plugin: DailyLoggingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TASKS;
	}

	getDisplayText(): string {
		return 'Task list';
	}

	getIcon(): string {
		return 'list-checks';
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('daily-logging-tasks');

		// サイドバーではビューのヘッダーが表示されないので、本文の上部にボタンを置く
		const header = root.createDiv({ cls: 'nav-header' });
		const buttons = header.createDiv({ cls: 'nav-buttons-container' });
		const refresh = buttons.createDiv({
			cls: 'clickable-icon nav-action-button',
			attr: { 'aria-label': 'Refresh' },
		});
		setIcon(refresh, 'refresh-cw');
		this.registerDomEvent(refresh, 'click', () => this.render());

		this.listEl = root.createDiv({ cls: 'daily-logging-list' });
		this.registerAutoRefresh();
		this.render();
	}

	/** 一覧を自動で描き直すためのイベントを登録する */
	private registerAutoRefresh(): void {
		const { metadataCache, vault } = this.app;
		const requestRender = debounce(() => this.render(), 300, true);

		// 表示中のタスク、または変更後にタスクになったファイルなら描き直す
		this.registerEvent(
			metadataCache.on('changed', (file, _data, cache) => {
				const isTask = readTask(cache.frontmatter, this.plugin.taskPropNames()) !== null;
				if (isTask || this.shown.has(file.path)) requestRender();
			}),
		);
		this.registerEvent(
			vault.on('delete', (file) => {
				if (this.shown.has(file.path)) requestRender();
			}),
		);
		this.registerEvent(
			vault.on('rename', (_file, oldPath) => {
				if (this.shown.has(oldPath)) requestRender();
			}),
		);

		// 起動直後はプロパティがまだ読み込まれていないことがあるので、読み込みが終わったら1回描き直す
		const resolved = metadataCache.on('resolved', () => {
			metadataCache.offref(resolved);
			this.render();
		});
		this.registerEvent(resolved);

		// 論理上の日付が変わったとき、Daily notes が使えるかどうかが変わったときに描き直す
		this.registerInterval(
			window.setInterval(() => {
				const today = this.plugin.taskContext().today.format('YYYY-MM-DD');
				const available = getDailyNotes(this.app) !== null;
				if (today !== this.shownDay || available !== this.shownAvailable) this.render();
			}, 60_000),
		);
	}

	/** 今日表示するタスクを集める */
	private collect(ctx: TaskContext): TaskEntry[] {
		const names = this.plugin.taskPropNames();
		const dn = getDailyNotes(this.app);
		const entries: TaskEntry[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (dn && isDailyNote(file, dn)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const props = readTask(fm, names);
			if (!props || !isVisible(props, ctx)) continue;
			entries.push({ file, name: file.basename, props, group: groupOf(props, ctx) });
		}
		return entries;
	}

	private groupTitle(group: number, ctx: TaskContext): string {
		const labels = this.plugin.taskLabels();
		if (group === GROUP_RUNNING) return labels.running;
		if (group === GROUP_OTHER) return labels.other;
		return ctx.slots[group]?.heading ?? labels.other;
	}

	render(): void {
		const root = this.listEl;
		if (!root) return; // まだ開かれていない
		const ctx = this.plugin.taskContext();
		const entries = this.collect(ctx);
		this.shown = new Set(entries.map((e) => e.file.path));
		this.shownDay = ctx.today.format('YYYY-MM-DD');
		this.shownAvailable = getDailyNotes(this.app) !== null;
		root.empty();

		if (!this.shownAvailable) {
			root.createEl('p', { cls: 'daily-logging-warning', text: NO_DAILY_NOTES_MESSAGE });
		}

		if (entries.length === 0) {
			root.createEl('p', { cls: 'daily-logging-empty', text: 'No tasks for today.' });
			return;
		}

		const groups = [...new Set(entries.map((e) => e.group))].sort((a, b) => a - b);
		for (const group of groups) {
			const section = root.createDiv({ cls: 'daily-logging-group' });
			section.createEl('h4', { text: this.groupTitle(group, ctx) });
			const list = section.createEl('ul');

			entries
				.filter((e) => e.group === group)
				.sort(compareTasks)
				.forEach((e) => this.renderTask(list, e, ctx));
		}
	}

	private renderTask(list: HTMLElement, entry: TaskEntry, ctx: TaskContext): void {
		const item = list.createEl('li', { cls: 'daily-logging-task' });

		const link = item.createEl('a', { cls: 'daily-logging-task-name', text: entry.name });
		link.addEventListener('click', (evt) => {
			void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(entry.file);
		});

		// 今日の予定時刻があれば表示する
		const s = entry.props.scheduled;
		if (s?.hasTime && scheduledDay(s, ctx).isSame(ctx.today, 'day')) {
			item.createSpan({ cls: 'daily-logging-task-meta', text: s.value.format('HH:mm') });
		}

		// 実行中なら「中断」「終了」、それ以外なら「開始」を表示する
		const labels = this.plugin.taskLabels();
		const file = entry.file;
		const actions: { label: string; run: () => Promise<void> }[] = isRunning(entry.props)
			? [
					{ label: labels.interrupt, run: () => this.plugin.interruptTask(file) },
					{ label: labels.end, run: () => this.plugin.endTask(file) },
				]
			: [{ label: labels.start, run: () => this.plugin.startTask(file) }];

		const buttons: HTMLButtonElement[] = [];
		for (const action of actions) {
			const button = item.createEl('button', {
				cls: 'daily-logging-task-button',
				text: action.label,
			});
			buttons.push(button);
			button.addEventListener('click', () => {
				for (const b of buttons) b.disabled = true; // 二重に押されないようにする
				void action
					.run()
					.catch(reportError)
					.finally(() => this.render());
			});
		}
	}
}
