import {
	ItemView,
	Keymap,
	Menu,
	debounce,
	getFrontMatterInfo,
	moment,
	setIcon,
	setTooltip,
} from 'obsidian';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import type DailyLoggingPlugin from './main';
import { NO_DAILY_NOTES_MESSAGE, getDailyNotes, isDailyNote, reportError } from './daily-notes';
import {
	GROUP_OTHER,
	GROUP_RUNNING,
	UNKNOWN_TIME,
	compareTasks,
	currentSlot,
	effectiveScheduled,
	formatDuration,
	groupByTag,
	groupOf,
	isRunning,
	isVisible,
	readTask,
	scheduledDay,
	slotEnd,
} from './task';
import type { Moment, TaskContext, TaskDate, TaskProps } from './task';
import { isIconId } from './settings';
import { firstOpenItem } from './time-slots';

export const VIEW_TYPE_TASKS = 'daily-logging-tasks';

interface TaskEntry {
	file: TFile;
	name: string;
	props: TaskProps;
	scheduled: TaskDate | null; // 予定日時（空なら予定時刻）
	group: number;
}

export class TaskView extends ItemView {
	plugin: DailyLoggingPlugin;

	/** 一覧を描く場所（上部のボタンは描き直さない） */
	private listEl: HTMLElement | null = null;

	/** スキップボタンの表示を切り替える、上部のボタン */
	private skipToggleEl: HTMLElement | null = null;

	/** デイリーノートの移動ボタン（前・今日・次） */
	private dailyNavEls: { prev: HTMLElement; today: HTMLElement; next: HTMLElement } | null = null;

	/** 今表示しているタスクのパス（再描画が必要かの判定に使う） */
	private shown = new Set<string>();

	/** 今表示している論理上の日付 */
	private shownDay = '';

	/** 表示したときにデイリーノートが使えたか */
	private shownAvailable = true;

	/** 表示したときの今の時間帯（強調するグループ） */
	private shownSlot: number | null = null;

	/** 今の時間帯の見出しの、残り時間を書く場所（見出しが出ていなければ null） */
	private remainingEl: HTMLElement | null = null;

	/** 実行中のタスクの、経過時間を書く場所と開始日時 */
	private elapsedEls: { el: HTMLElement; start: Moment }[] = [];

	/** ノートから読んだ表示名（パスごと。読んだときの更新日時と見出し名が同じ間だけ使う） */
	private titles = new Map<string, { mtime: number; heading: string; title: string | null }>();

	/** 表示名を読んでいるパス（同じノートを重ねて読まない） */
	private loadingTitles = new Set<string>();

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

		// デイリーノートの移動（前・今日・次）。無効なボタンは押しても何もしない
		const navButton = (icon: string, label: string, run: () => Promise<void>) => {
			const el = buttons.createDiv({
				cls: 'clickable-icon nav-action-button',
				attr: { 'aria-label': label },
			});
			setIcon(el, icon);
			this.registerDomEvent(el, 'click', () => {
				if (!el.hasClass('is-disabled')) void run().catch(reportError);
			});
			return el;
		};
		this.dailyNavEls = {
			prev: navButton('chevron-left', 'Previous daily note', () => this.plugin.openAdjacent(-1)),
			today: navButton('calendar', "Open today's daily note", () => this.plugin.openToday()),
			next: navButton('chevron-right', 'Next daily note', () => this.plugin.openAdjacent(1)),
		};

		const skipToggle = buttons.createDiv({ cls: 'clickable-icon nav-action-button' });
		this.skipToggleEl = skipToggle;
		this.registerDomEvent(skipToggle, 'click', () => {
			const settings = this.plugin.settings;
			settings.showSkipButtons = !settings.showSkipButtons;
			this.render();
			void this.plugin.saveSettings().catch(reportError);
		});

		const refresh = buttons.createDiv({
			cls: 'clickable-icon nav-action-button',
			attr: { 'aria-label': 'Refresh' },
		});
		setIcon(refresh, 'refresh-cw');
		// 予定も取得してから描き直す（URL かトークンが未設定なら、描き直すだけ）
		this.registerDomEvent(refresh, 'click', () => {
			void this.plugin.fetchCalendar().finally(() => this.render());
		});

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

		// 前後のデイリーノートがあるかは、開いているノートと、ファイルの増減で変わる
		const requestNav = debounce(() => this.updateDailyNav(), 300, true);
		// 同じタブの中でノートを切り替えたときは active-leaf-change が出ないので、file-open も見る
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateDailyNav()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.updateDailyNav()));
		this.registerEvent(vault.on('create', requestNav));
		this.registerEvent(vault.on('delete', requestNav));
		this.registerEvent(vault.on('rename', requestNav));

		// 起動直後はプロパティがまだ読み込まれていないことがあるので、読み込みが終わったら1回描き直す
		const resolved = metadataCache.on('resolved', () => {
			metadataCache.offref(resolved);
			this.render();
		});
		this.registerEvent(resolved);

		// 論理上の日付、今の時間帯、Daily notes が使えるかどうかが変わったときに描き直す。
		// 残り時間は毎回書き換える（遅れが1分近くにならないよう、10秒ごとに確かめる）
		this.registerInterval(
			window.setInterval(() => {
				const ctx = this.plugin.taskContext();
				const today = ctx.today.format('YYYY-MM-DD');
				const slot = currentSlot(ctx, moment());
				const available = getDailyNotes(this.app) !== null;
				if (
					today !== this.shownDay ||
					slot !== this.shownSlot ||
					available !== this.shownAvailable
				) {
					this.render();
				} else {
					this.updateTimers(ctx);
				}
			}, 10_000),
		);
	}

	/** 今日表示するタスクを集める */
	private collect(ctx: TaskContext): TaskEntry[] {
		const names = this.plugin.taskPropNames();
		const dn = getDailyNotes(this.app);
		const holidayNote = this.plugin.holidayNote();
		const entries: TaskEntry[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (dn && isDailyNote(file, dn)) continue;
			if (file === holidayNote) continue; // 休日の判定に使うノートはタスクではない
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const props = readTask(fm, names);
			if (!props || !isVisible(props, ctx)) continue;
			entries.push({
				file,
				name: this.titleOf(file) ?? file.basename,
				props,
				scheduled: effectiveScheduled(props, ctx),
				group: groupOf(props, ctx),
			});
		}
		return entries;
	}

	/**
	 * タスクの表示名。読んだものがなければ、読み始めて、読み終えたら描き直す。
	 * 読み終えるまでは前に読んだ表示名（なければ null で、ファイル名になる）を返す
	 */
	private titleOf(file: TFile): string | null {
		const heading = this.plugin.settings.titleHeading.trim();
		if (heading === '') return null;
		const cached = this.titles.get(file.path);
		if (cached?.mtime === file.stat.mtime && cached.heading === heading) return cached.title;

		if (!this.loadingTitles.has(file.path)) {
			this.loadingTitles.add(file.path);
			this.app.vault
				.cachedRead(file)
				.then((data) => {
					// フロントマターの「# コメント」を見出しと取り違えないよう、本文だけを見る
					const body = data.slice(getFrontMatterInfo(data).contentStart);
					const title = firstOpenItem(body, heading);
					const changed = (cached?.title ?? null) !== title;
					this.titles.set(file.path, { mtime: file.stat.mtime, heading, title });
					if (changed) this.render();
				})
				.catch(reportError)
				.finally(() => this.loadingTitles.delete(file.path));
		}
		return cached?.title ?? null;
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
		this.shownSlot = currentSlot(ctx, moment());
		this.remainingEl = null;
		this.elapsedEls = [];
		this.updateSkipToggle();
		this.updateDailyNav();
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
			const title = this.groupTitle(group, ctx);
			const sorted = entries.filter((e) => e.group === group).sort(compareTasks);
			const collapsed = this.plugin.settings.collapsedGroups.includes(title);

			// 見出しを押すと、グループを閉じたり開いたりする（閉じている間は件数を出す）
			const section = root.createDiv({ cls: 'daily-logging-group' });
			section.toggleClass('is-collapsed', collapsed);
			const heading = section.createEl('h4', {
				attr: { role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed) },
			});
			setIcon(
				heading.createSpan({ cls: 'daily-logging-group-chevron' }),
				collapsed ? 'chevron-right' : 'chevron-down',
			);
			heading.createSpan({ text: collapsed ? `${title} (${sorted.length})` : title });
			if (group === this.shownSlot) {
				heading.addClass('is-current');
				this.remainingEl = heading.createSpan({ cls: 'daily-logging-remaining' });
				this.updateRemaining(ctx);
			}
			const toggle = () => this.toggleGroup(title);
			heading.addEventListener('click', toggle);
			heading.addEventListener('keydown', (evt) => {
				if (evt.key === 'Enter' || evt.key === ' ') {
					evt.preventDefault();
					toggle();
				}
			});
			if (collapsed) continue;
			const list = section.createEl('ul');

			for (const item of groupByTag(sorted)) {
				if (!('tag' in item)) {
					this.renderTask(list, item, ctx);
					continue;
				}
				// 同じタグのタスクは、タグ名の小見出しの下に字下げして並べる
				const sub = list.createEl('li', { cls: 'daily-logging-subgroup' });
				sub.createDiv({ cls: 'daily-logging-subgroup-title', text: item.tag });
				const subList = sub.createEl('ul');
				for (const e of item.entries) this.renderTask(subList, e, ctx);
			}
		}
	}

	/** グループを閉じたり開いたりして、data.json に保存する */
	private toggleGroup(title: string): void {
		const settings = this.plugin.settings;
		const collapsed = settings.collapsedGroups;
		// 既定値の配列を書き換えないよう、新しい配列にする
		settings.collapsedGroups = collapsed.includes(title)
			? collapsed.filter((t) => t !== title)
			: [...collapsed, title];
		this.render();
		void this.plugin.saveSettings().catch(reportError);
	}

	/** デイリーノートの移動ボタンを、開けるものがあるかに合わせて有効・無効にする */
	private updateDailyNav(): void {
		const els = this.dailyNavEls;
		if (!els) return;
		const available = getDailyNotes(this.app) !== null;
		const setEnabled = (el: HTMLElement, enabled: boolean) => {
			el.toggleClass('is-disabled', !enabled);
			el.setAttribute('aria-disabled', String(!enabled));
		};
		setEnabled(els.today, available);
		setEnabled(els.prev, available && this.plugin.adjacentDailyNote(-1) !== null);
		setEnabled(els.next, available && this.plugin.adjacentDailyNote(1) !== null);
	}

	/** スキップボタンの表示を切り替えるボタンの、アイコン・ラベル・状態を今の設定に合わせる */
	private updateSkipToggle(): void {
		const el = this.skipToggleEl;
		if (!el) return;
		const { skipIcon, showSkipButtons } = this.plugin.settings;
		setIcon(el, isIconId(skipIcon) ? skipIcon.trim() : 'skip-forward');
		el.setAttribute('aria-label', showSkipButtons ? 'Hide skip buttons' : 'Show skip buttons');
		el.toggleClass('is-active', showSkipButtons);
	}

	/** 残り時間と、実行中のタスクの経過時間を書き換える */
	private updateTimers(ctx: TaskContext): void {
		this.updateRemaining(ctx);
		const now = moment();
		for (const { el, start } of this.elapsedEls) el.setText(formatDuration(start, now));
	}

	/** 今の時間帯の残り時間を書き換える。終わりを過ぎていれば 00:00 */
	private updateRemaining(ctx: TaskContext): void {
		if (!this.remainingEl || this.shownSlot === null) return;
		const end = slotEnd(ctx, this.shownSlot);
		this.remainingEl.setText(end ? `${formatDuration(moment(), end)} left` : '');
	}

	private renderTask(list: HTMLElement, entry: TaskEntry, ctx: TaskContext): void {
		const item = list.createEl('li', { cls: 'daily-logging-task' });
		if (isRunning(entry.props)) item.addClass('is-running');

		const link = item.createEl('a', { cls: 'daily-logging-task-name', text: entry.name });
		link.addEventListener('click', (evt) => {
			void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(entry.file);
		});

		// 右クリック（モバイルは長押し）で、押し忘れたときの記録を出す
		item.addEventListener('contextmenu', (evt) => {
			evt.preventDefault();
			const file = entry.file;
			const items: { title: string; icon: string; run: () => Promise<void> }[] = isRunning(
				entry.props,
			)
				? [{ title: 'Forgot to end', icon: 'check', run: () => this.plugin.forgotEndTask(file) }]
				: [
						{ title: 'Forgot to start', icon: 'play', run: () => this.plugin.forgotStartTask(file) },
						{ title: 'Already done', icon: 'check-check', run: () => this.plugin.doneTask(file) },
					];
			const menu = new Menu();
			for (const { title, icon, run } of items) {
				menu.addItem((mi) =>
					mi
						.setTitle(title)
						.setIcon(icon)
						.onClick(() => {
							void run()
								.catch(reportError)
								.finally(() => this.render());
						}),
				);
			}
			menu.showAtMouseEvent(evt);
		});

		// 実行中なら開始からの経過時間（開始忘れなら ??:??）、そうでなければ今日の予定時刻を表示する
		const s = entry.scheduled;
		const start = isRunning(entry.props) ? entry.props.start : null;
		if (start && !entry.props.startKnown) {
			item.createSpan({
				cls: ['daily-logging-task-meta', 'daily-logging-elapsed'],
				text: UNKNOWN_TIME,
			});
		} else if (start) {
			const el = item.createSpan({
				cls: ['daily-logging-task-meta', 'daily-logging-elapsed'],
				text: formatDuration(start, moment()),
			});
			this.elapsedEls.push({ el, start });
		} else if (s?.hasTime && scheduledDay(s, ctx).isSame(ctx.today, 'day')) {
			item.createSpan({ cls: 'daily-logging-task-meta', text: s.value.format('HH:mm') });
		}

		// 実行中なら「中断」「終了」、それ以外なら「開始」「スキップ」を表示する
		const labels = this.plugin.taskLabels();
		const settings = this.plugin.settings;
		const file = entry.file;
		const actions: { label: string; icon: string; run: () => Promise<void> }[] = isRunning(
			entry.props,
		)
			? [
					{
						label: labels.interrupt,
						icon: settings.interruptIcon,
						run: () => this.plugin.interruptTask(file),
					},
					{ label: labels.end, icon: settings.endIcon, run: () => this.plugin.endTask(file) },
				]
			: [
					{ label: labels.start, icon: settings.startIcon, run: () => this.plugin.startTask(file) },
					...(settings.showSkipButtons
						? [{ label: labels.skip, icon: settings.skipIcon, run: () => this.plugin.skipTask(file) }]
						: []),
				];

		const buttons: HTMLButtonElement[] = [];
		for (const action of actions) {
			const button = item.createEl('button', { cls: 'daily-logging-task-button' });
			// アイコンがなければ、文字を出さない設定でも文字を出す
			const icon = action.icon.trim();
			const hasIcon = isIconId(icon);
			if (hasIcon) setIcon(button.createSpan({ cls: 'daily-logging-task-button-icon' }), icon);
			if (!hasIcon || settings.showButtonText) {
				button.createSpan({ text: action.label });
			} else {
				button.setAttribute('aria-label', action.label);
				setTooltip(button, action.label);
			}
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
