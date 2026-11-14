import { MarkdownView, Modal } from 'obsidian';
import type { App } from 'obsidian';

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
		private sourcePath: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		const list = this.contentEl.createDiv({ cls: 'daily-logging-links' });
		const buttons = this.links.map((link, i) => {
			const button = list.createEl('button', {
				cls: i === 0 ? 'mod-cta' : '',
				text: link.text,
				attr: { 'aria-label': link.target },
			});
			button.addEventListener('click', () => {
				this.close();
				if (link.kind === 'url') {
					window.open(link.target);
				} else {
					void this.app.workspace.openLinkText(link.target, this.sourcePath, 'tab');
				}
			});
			return button;
		});

		const footer = this.contentEl.createDiv({ cls: 'modal-button-container' });
		footer.createEl('button', { text: 'Close' }).addEventListener('click', () => this.close());

		// 1つ目のリンクにフォーカスし、Enter で開けるようにする
		buttons[0]?.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		// 開始後に出したデイリーノートのカーソルへ、そのまま戻れるようにする
		this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.focus();
	}
}
