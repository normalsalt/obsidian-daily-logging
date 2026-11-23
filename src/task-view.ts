import {
	ItemView,
	Keymap,
	Menu,
	debounce,
	moment,
	setIcon,
	setTooltip,
} from 'obsidian';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import type DailyLoggingPlugin from './main';
import { NO_DAILY_NOTES_MESSAGE, getDailyNotes, reportError } from './daily-notes';
import {
	GROUP_OTHER,
	GROUP_RUNNING,
	GROUP_SKIPPED,
	UNKNOWN_TIME,
	compareTasks,
	currentSlot,
	formatDuration,
	groupByTag,
	isRunning,
	nameLines,
	orderTasks,
	readTask,
	rowScale,
	scheduledDay,
	slotEnd,
} from './task';
import type { Moment, TaskContext, TaskEntry } from './task';
import type { Weekdays } from './time-slots';
import { isIconId } from './settings';
import { SleepConfirmModal } from './link-modal';

export const VIEW_TYPE_TASKS = 'daily-logging-tasks';

export class TaskView extends ItemView {
	plugin: DailyLoggingPlugin;

	/** 一覧を描く場所（上部のボタンは描き直さない） */
	private listEl: HTMLElement | null = null;

	/** 今表示しているグループの見出しの名前と、実行中か、今の時間帯のグループか、スキップ済みか */
	private shownGroups: { title: string; running: boolean; current: boolean; skipped: boolean }[] =
		[];

	/** スキップ済みのグループを開いているか（保存しないので、開き直すと閉じた状態から始まる） */
	private skippedOpen = false;

	/** グループをまとめて閉じる・開くボタン */
	private collapseToggleEl: HTMLElement | null = null;

	/** デイリーノートの移動ボタン（前・今日・次） */
	private dailyNavEls: { prev: HTMLElement; today: HTMLElement; next: HTMLElement } | null = null;

	/** 就寝の処理中か（途中の再描画でも、就寝ボタンを押せないままにする） */
	private sleeping = false;

	/** 今表示しているタスクのパス（再描画が必要かの判定に使う） */
	private shown = new Set<string>();

	/** 今表示しているタスクを、一覧の上からの順に（閉じたグループも含む。スキップ済みは除く。就寝でスキップする順） */
	private shownOrder: TaskEntry[] = [];

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
	private titles = new Map<string, { mtime: number; heading: string; day: string; title: string | null }>();

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

		// 割り込みタスクを記録する（実行中のタスクはすべて中断する）
		navButton('zap', 'Log an interruption', () => {
			this.plugin.openInterruptionModal(() => this.render());
			return Promise.resolve();
		});

		// 閉じられるグループが開いていれば閉じ、なければすべて開く
		this.collapseToggleEl = navButton('chevrons-down-up', 'Collapse groups', () => {
			if (this.canCollapse()) this.collapseOthers();
			else this.setCollapsed([]);
			return Promise.resolve();
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
					this.measureRowHeight(); // 一覧が隠れていて測れなかったときのため
				}
			}, 10_000),
		);
	}

	/**
	 * タスクの表示名。読んだものがなければ、読み始めて、読み終えたら描き直す。
	 * 読み終えるまでは前に読んだ表示名（なければ null で、ファイル名になる）を返す
	 */
	private titleOf(file: TFile, days: Weekdays): string | null {
		const heading = this.plugin.settings.titleHeading.trim();
		if (heading === '') return null;
		const cached = this.titles.get(file.path);
		// 曜日だけを書いたバレットで表示名が変わるので、曜日や平日・休日が変わったら読み直す
		const day = days.today.join('\n');
		if (cached?.mtime === file.stat.mtime && cached.heading === heading && cached.day === day) {
			return cached.title;
		}

		if (!this.loadingTitles.has(file.path)) {
			this.loadingTitles.add(file.path);
			this.plugin
				.readTitle(file, heading, days)
				.then((title) => {
					const changed = (cached?.title ?? null) !== title;
					this.titles.set(file.path, { mtime: file.stat.mtime, heading, day, title });
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
		if (group === GROUP_SKIPPED) return labels.skipped;
		return ctx.slots[group]?.heading ?? labels.other;
	}

	render(): void {
		const root = this.listEl;
		if (!root) return; // まだ開かれていない
		const ctx = this.plugin.taskContext();
		const days = this.plugin.weekdays(ctx);
		const entries = this.plugin.collectTasks(ctx, (file) => this.titleOf(file, days) ?? file.basename);
		this.shown = new Set(entries.map((e) => e.file.path));
		this.shownDay = ctx.today.format('YYYY-MM-DD');
		this.shownAvailable = getDailyNotes(this.app) !== null;
		this.shownSlot = currentSlot(ctx, moment());
		this.remainingEl = null;
		this.elapsedEls = [];
		this.updateDailyNav();
		root.empty();
		// 描き終えてから、見積時間のない行の高さを測る（行の高さを広げる基準）
		window.requestAnimationFrame(() => this.measureRowHeight());

		const groups = [...new Set(entries.map((e) => e.group))].sort((a, b) => a - b);
		// 就寝の行を置けるグループか（実行中とスキップ済みには置かない）
		const holdsSleep = (g: number) => g !== GROUP_RUNNING && g !== GROUP_SKIPPED;
		this.shownOrder = orderTasks(entries).filter((e) => e.group !== GROUP_SKIPPED);
		// 実行中とスキップ済みのほかにタスクがなければ、今の時間帯の見出し（件数 0）の中に
		// 「タスクなし」と就寝の行を出す
		if (!groups.some(holdsSleep) && this.shownSlot !== null) groups.push(this.shownSlot);
		this.shownGroups = groups.map((group) => ({
			title: this.groupTitle(group, ctx),
			running: group === GROUP_RUNNING,
			current: group === this.shownSlot,
			skipped: group === GROUP_SKIPPED,
		}));
		this.updateCollapseToggle();

		if (!this.shownAvailable) {
			root.createEl('p', { cls: 'daily-logging-warning', text: NO_DAILY_NOTES_MESSAGE });
		}

		let lastList: HTMLElement | null = null;
		for (const group of groups) {
			const title = this.groupTitle(group, ctx);
			const sorted = entries.filter((e) => e.group === group).sort(compareTasks);
			const collapsed = this.isCollapsed({ title, skipped: group === GROUP_SKIPPED });

			// 見出しを押すと、グループを閉じたり開いたりする（見出しには件数を出す）
			const section = root.createDiv({ cls: 'daily-logging-group' });
			section.toggleClass('is-collapsed', collapsed);
			const heading = section.createEl('h4', {
				attr: { role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed) },
			});
			setIcon(
				heading.createSpan({ cls: 'daily-logging-group-chevron' }),
				collapsed ? 'chevron-right' : 'chevron-down',
			);
			heading.createSpan({ text: `${title} (${sorted.length})` });
			heading.toggleClass('is-running', group === GROUP_RUNNING);
			if (group === this.shownSlot) {
				heading.addClass('is-current');
				this.remainingEl = heading.createSpan({ cls: 'daily-logging-remaining' });
				this.updateRemaining(ctx);
			}
			const toggle = () =>
				group === GROUP_SKIPPED ? this.toggleSkippedGroup() : this.toggleGroup(title);
			heading.addEventListener('click', toggle);
			heading.addEventListener('keydown', (evt) => {
				if (evt.key === 'Enter' || evt.key === ' ') {
					evt.preventDefault();
					toggle();
				}
			});
			// 閉じたグループが最後なら、就寝の行も一緒に隠す
			if (holdsSleep(group)) lastList = null;
			if (collapsed) continue;
			const list = section.createEl('ul');
			if (holdsSleep(group)) lastList = list;
			if (sorted.length === 0) {
				list.createEl('li', {
					cls: ['daily-logging-task', 'daily-logging-empty-row'],
					text: 'No tasks for today.',
				});
			}

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
		// 実行中とスキップ済みのほかにグループがなければ、「タスクなし」と就寝の行を出す
		if (!groups.some(holdsSleep)) {
			root.createEl('p', { cls: 'daily-logging-empty', text: 'No tasks for today.' });
			this.renderSleepRow(root.createDiv({ cls: 'daily-logging-group' }).createEl('ul'));
			return;
		}
		// 就寝の行は、実行中とスキップ済みを除いた最後のグループの末尾に置く
		if (lastList) this.renderSleepRow(lastList);
	}

	/**
	 * 就寝の行を置く。見た目はタスクの行と同じで、開始ボタンだけが押せる
	 * （行を押してもノートは開かず、名前もリンクの色にしない）
	 */
	private renderSleepRow(list: HTMLElement): void {
		const labels = this.plugin.taskLabels();
		const settings = this.plugin.settings;
		const item = list.createEl('li', { cls: ['daily-logging-task', 'daily-logging-sleep'] });
		item.createSpan({ cls: 'daily-logging-task-name', text: labels.sleep });
		const button = item.createEl('button', { cls: 'daily-logging-task-button' });
		fillButton(button, labels.start, settings.startIcon, settings);
		button.disabled = this.sleeping;
		button.addEventListener('click', () => this.confirmSleep());
	}

	/** 確認してから、一覧のタスクを上から順にスキップし、就寝を記録する */
	private confirmSleep(): void {
		const files = this.shownOrder.map((e) => e.file);
		const running = this.shownOrder.filter((e) => isRunning(e.props)).length;
		new SleepConfirmModal(this.app, files.length, running, () => {
			this.sleeping = true; // 二重に押されないようにする
			this.render();
			void this.plugin
				.goToBed(files)
				.catch(reportError)
				.finally(() => {
					this.sleeping = false;
					this.render();
				});
		}).open();
	}

	/** グループを閉じたり開いたりする */
	private toggleGroup(title: string): void {
		const collapsed = this.plugin.settings.collapsedGroups;
		this.setCollapsed(
			collapsed.includes(title) ? collapsed.filter((t) => t !== title) : [...collapsed, title],
		);
	}

	/** スキップ済みのグループを閉じたり開いたりする（自分で開くまでは閉じたまま） */
	private toggleSkippedGroup(): void {
		this.skippedOpen = !this.skippedOpen;
		this.render();
	}

	/** グループが閉じているか。スキップ済みのグループは、開いたときだけ開く */
	private isCollapsed(g: { title: string; skipped: boolean }): boolean {
		return g.skipped
			? !this.skippedOpen
			: this.plugin.settings.collapsedGroups.includes(g.title);
	}

	/** ボタンで閉じずに残すグループか（実行中と、設定がオンなら今の時間帯） */
	private keepsOpen(g: { running: boolean; current: boolean }): boolean {
		return g.running || (g.current && this.plugin.settings.keepCurrentGroupOpen);
	}

	/** 閉じられるグループのうち、開いているものがあるか */
	private canCollapse(): boolean {
		return this.shownGroups.some((g) => !this.keepsOpen(g) && !this.isCollapsed(g));
	}

	/** まとめて閉じる・開くボタンのアイコンとラベルを、今の状態に合わせる */
	private updateCollapseToggle(): void {
		const el = this.collapseToggleEl;
		if (!el) return;
		const collapse = this.canCollapse();
		setIcon(el, collapse ? 'chevrons-down-up' : 'chevrons-up-down');
		el.setAttribute('aria-label', collapse ? 'Collapse groups' : 'Expand all groups');
	}

	/** 表示しているグループのうち、残すグループのほかを閉じる（残すグループは開く） */
	private collapseOthers(): void {
		this.skippedOpen = false;
		const groups = this.shownGroups.filter((g) => !g.skipped);
		const keep = new Set(groups.filter((g) => this.keepsOpen(g)).map((g) => g.title));
		const others = groups.filter((g) => !this.keepsOpen(g)).map((g) => g.title);
		const collapsed = this.plugin.settings.collapsedGroups.filter((t) => !keep.has(t));
		this.setCollapsed([...new Set([...collapsed, ...others])]);
	}

	/**
	 * 閉じているグループを入れ替えて描き直し、data.json に保存する（既定値の配列は書き換えない）。
	 * スキップ済みのグループは、自分で開くまで閉じたままにするので、ここでは開かない
	 */
	private setCollapsed(titles: string[]): void {
		this.plugin.settings.collapsedGroups = titles;
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

	/**
	 * 見積時間のない、ボタンのある行の高さを測り、一覧の CSS 変数に入れる。
	 * 一覧が隠れていて測れない（0）ときや、そういう行がないときは、前の値のままにする
	 */
	private measureRowHeight(): void {
		const root = this.listEl;
		const row = root?.querySelector<HTMLElement>(
			'.daily-logging-task:not(.has-estimate):not(.daily-logging-empty-row)',
		);
		const height = row?.getBoundingClientRect().height ?? 0;
		if (root && height > 0) root.setCssProps({ '--daily-logging-row-height': `${height}px` });
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
		// 見積時間があれば、その分だけ行を高くし、名前は見積時間に応じた行数まで折り返す
		if (entry.props.estimate !== null) {
			const lines = nameLines(entry.props);
			item.addClass('has-estimate');
			item.toggleClass('is-multiline', lines >= 2);
			item.setCssProps({
				'--daily-logging-row-scale': String(rowScale(entry.props)),
				'--daily-logging-name-lines': String(lines),
			});
		}

		item.createEl('a', { cls: 'daily-logging-task-name', text: entry.name });
		// ボタンのほかの場所を押したら、タスクのノートを開く
		item.addEventListener('click', (evt) => {
			if (evt.target instanceof Element && evt.target.closest('button')) return;
			void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(entry.file);
		});

		// 右クリック（モバイルは長押し）で、スキップと、押し忘れたときの記録を出す
		item.addEventListener('contextmenu', (evt) => {
			evt.preventDefault();
			const file = entry.file;
			const items: { title: string; icon: string; run: () => Promise<unknown> }[] = isRunning(
				entry.props,
			)
				? [{ title: 'Forgot to end', icon: 'check', run: () => this.plugin.forgotEndTask(file) }]
				: [
						// スキップ済みのタスクには、スキップを出さない
						...(entry.group === GROUP_SKIPPED
							? []
							: [{ title: 'Skip', icon: 'skip-forward', run: () => this.plugin.skipTask(file) }]),
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

		// 実行中なら「中断」「終了」、それ以外なら「開始」を表示する
		const labels = this.plugin.taskLabels();
		const settings = this.plugin.settings;
		const file = entry.file;
		const actions: { label: string; icon: string; run: () => Promise<unknown> }[] = isRunning(
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
				];

		const buttons: HTMLButtonElement[] = [];
		for (const action of actions) {
			const button = item.createEl('button', { cls: 'daily-logging-task-button' });
			fillButton(button, action.label, action.icon, settings);
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

/** ボタンにアイコンと文字を入れる。アイコンがなければ、文字を出さない設定でも文字を出す */
function fillButton(
	button: HTMLButtonElement,
	label: string,
	iconName: string,
	settings: { showButtonText: boolean },
): void {
	const icon = iconName.trim();
	const hasIcon = isIconId(icon);
	if (hasIcon) setIcon(button.createSpan({ cls: 'daily-logging-task-button-icon' }), icon);
	if (!hasIcon || settings.showButtonText) {
		button.createSpan({ text: label });
	} else {
		button.setAttribute('aria-label', label);
		setTooltip(button, label);
	}
}
