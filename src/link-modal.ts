import { MarkdownView, Modal } from 'obsidian';
import type { App, TFile } from 'obsidian';

/** プロパティの値から拾ったリンク */
export interface FoundLink {
	kind: 'url' | 'note';
	target: string;
	text: string;
}

// Markdown リンク、内部リンク、裸の URL の順に試す（同じ位置なら前のものが優先）
const LINK_PATTERN = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|\[\[([^\]]+)\]\]|https?:\/\/[^\s<>"]+/g;

/** 文字列か文字列のリストから、URL と内部リンクを出てきた順に拾う（重複は除く） */
export function findLinks(value: unknown): FoundLink[] {
	const texts = (Array.isArray(value) ? value : [value]).filter(
		(v): v is string => typeof v === 'string',
	);
	const links: FoundLink[] = [];
	const seen = new Set<string>();
	const add = (link: FoundLink) => {
		const key = `${link.kind}:${link.target}`;
		if (seen.has(key) || link.target === '') return;
		seen.add(key);
		links.push(link);
	};

	for (const text of texts) {
		for (const m of text.matchAll(LINK_PATTERN)) {
			const [whole, mdText, mdUrl, wiki] = m;
			if (mdUrl !== undefined) {
				add({ kind: 'url', target: mdUrl, text: mdText?.trim() || mdUrl });
			} else if (wiki !== undefined) {
				const [target = '', alias] = wiki.split('|');
				add({ kind: 'note', target: target.trim(), text: alias?.trim() || target.trim() });
			} else {
				// 文の終わりの句読点や括弧は URL に含めない
				const url = whole.replace(/[)\].,]+$/, '');
				add({ kind: 'url', target: url, text: url });
			}
		}
	}
	return links;
}

/** タスクを開始したときに、リンクをすぐ開けるように出すモーダル */
export class LinkModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private links: FoundLink[],
		private file: TFile,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		// 本文にリンクを1行ずつ並べる
		const list = this.contentEl.createDiv({ cls: 'daily-logging-links' });
		const anchors = this.links.map((link) => {
			const a = list.createDiv().createEl('a', {
				cls: link.kind === 'url' ? 'external-link' : 'internal-link',
				text: link.text,
				href: link.kind === 'url' ? link.target : '#',
			});
			a.addEventListener('click', (evt) => {
				evt.preventDefault();
				this.close();
				if (link.kind === 'url') {
					window.open(link.target);
				} else {
					void this.app.workspace.openLinkText(link.target, this.file.path, 'tab');
				}
			});
			return a;
		});

		addNoteButtons(this, this.file);

		// 1つ目のリンクにフォーカスし、Enter で開けるようにする
		anchors[0]?.focus();
	}

	onClose(): void {
		closeNoteModal(this);
	}
}

/** 周期のないタスクをスキップしたときに、もう一覧に出ないことを知らせるモーダル */
export class SkipWarningModal extends Modal {
	constructor(
		app: App,
		private file: TFile,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.file.basename);
		this.contentEl.createEl('p', {
			text: "This task doesn't repeat, so it won't appear in the task list again until you set a scheduled date.",
		});
		addNoteButtons(this, this.file).focus();
	}

	onClose(): void {
		closeNoteModal(this);
	}
}

/** 就寝する前に、スキップする件数を示して確かめるモーダル */
export class SleepConfirmModal extends Modal {
	constructor(
		app: App,
		private count: number,
		private running: number,
		private onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Go to bed');
		const tasks = (n: number, kind = '') => `${n} ${kind}task${n === 1 ? '' : 's'}`;
		let text = `Skip ${tasks(this.count)} in the list and log that you go to bed?`;
		if (this.running > 0) {
			text += ` ${tasks(this.running, 'running ')} will be ended first.`;
		}
		this.contentEl.createEl('p', { text });

		const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const ok = row.createEl('button', { cls: 'mod-cta', text: 'Go to bed' });
		ok.addEventListener('click', () => {
			this.close();
			this.onConfirm();
		});
		row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		ok.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** 「ノートを開く」と「閉じる」のボタンを並べる。ノートを開くボタンを返す */
function addNoteButtons(modal: Modal, file: TFile): HTMLButtonElement {
	const row = modal.contentEl.createDiv({ cls: 'modal-button-container' });
	const open = row.createEl('button', { text: 'Open note' });
	open.addEventListener('click', () => {
		modal.close();
		void modal.app.workspace.getLeaf('tab').openFile(file);
	});
	row.createEl('button', { text: 'Close' }).addEventListener('click', () => modal.close());
	return open;
}

function closeNoteModal(modal: Modal): void {
	modal.contentEl.empty();
	// 記録の後に出したデイリーノートのカーソルへ、そのまま戻れるようにする
	modal.app.workspace.getActiveViewOfType(MarkdownView)?.editor.focus();
}
