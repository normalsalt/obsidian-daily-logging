import { ItemView, Keymap, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type DailyLoggingPlugin from './main';
import { getDailyNotes, isDailyNote } from './daily-notes';
import {
	GROUP_OTHER,
	GROUP_RUNNING,
	TaskContext,
	TaskProps,
	compareTasks,
	groupOf,
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
		this.render();
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
		if (group === GROUP_RUNNING) return '実行中';
		if (group === GROUP_OTHER) return 'その他';
		return ctx.slots[group]?.heading ?? 'その他';
	}

	render(): void {
		const root = this.listEl;
		if (!root) return; // まだ開かれていない
		const ctx = this.plugin.taskContext();
		const entries = this.collect(ctx);
		root.empty();

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
	}
}
