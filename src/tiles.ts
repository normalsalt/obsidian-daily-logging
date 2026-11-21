import { FileView, Platform, WorkspaceLeaf } from 'obsidian';
import type { App, OpenViewState, TFile, WorkspaceParent } from 'obsidian';

/** ファイルを開くタイル。null なら振り分けない */
export type Side = 'left' | 'right' | null;

/** 中央のタブ（別ウィンドウは除く） */
function rootLeaves(app: App): WorkspaceLeaf[] {
	const leaves: WorkspaceLeaf[] = [];
	app.workspace.iterateRootLeaves((leaf) => {
		if (leaf.getRoot() === app.workspace.rootSplit) leaves.push(leaf);
	});
	return leaves;
}

/** 中央のタイル（タブのグループ）。並びの順なので、最初が左、最後が右 */
function tiles(leaves: WorkspaceLeaf[]): WorkspaceParent[] {
	const result: WorkspaceParent[] = [];
	for (const leaf of leaves) {
		if (!result.includes(leaf.parent)) result.push(leaf.parent);
	}
	return result;
}

/** そのタブが、side のタイルにあるか。タイルが1つだけなら、それを左とする */
export function isOnSide(app: App, leaf: WorkspaceLeaf, side: Side): boolean {
	if (side === null) return true;
	const groups = tiles(rootLeaves(app));
	if (side === 'left') return leaf.parent === groups[0];
	return groups.length >= 2 && leaf.parent === groups[groups.length - 1];
}

/** そのタブが、file を表示しているか */
function shows(leaf: WorkspaceLeaf, file: TFile): boolean {
	return leaf.view instanceof FileView && leaf.view.file?.path === file.path;
}

/**
 * WorkspaceLeaf.prototype.openFile を差し替え、side が決めたタイルでファイルを開く。
 * ノートを開く処理（リンク、ファイルエクスプローラー、クイックスイッチャーなど）は、ここを通る。
 * レイアウトの復元や「戻る・進む」は setViewState を通るので、振り分けない。
 * 差し替えを解除する関数を返す
 */
export function routeOpenFile(app: App, sideOf: (file: TFile) => Side): () => void {
	// eslint-disable-next-line @typescript-eslint/unbound-method -- 元の関数は、必ず call でタブを this にして呼ぶ
	const original = WorkspaceLeaf.prototype.openFile;
	let enabled = true;

	const openFile = async function (
		this: WorkspaceLeaf,
		file: TFile,
		openState?: OpenViewState,
	): Promise<void> {
		const side = enabled && !Platform.isPhone ? sideOf(file) : null;
		const { workspace } = app;
		if (side === null || this.getRoot() !== workspace.rootSplit) {
			return original.call(this, file, openState);
		}

		const leaves = rootLeaves(app);
		const groups = tiles(leaves);
		// 行き先のタイル。null なら、右に分割して作る
		let dest: WorkspaceParent | null;
		if (groups.length <= 1) dest = side === 'left' ? this.parent : null;
		else dest = (side === 'left' ? groups[0] : groups[groups.length - 1]) ?? null;
		if (dest === this.parent) return original.call(this, file, openState);

		const recent = workspace.getMostRecentLeaf();
		const show = openState?.active ?? recent === this;
		// 行き先のタイルですでに開いていれば、そのタブを使う（見出しへのリンクなら、その位置へ移る）
		let leaf = dest ? leaves.find((l) => l.parent === dest && shows(l, file)) : undefined;
		if (leaf) {
			// 前に出すのは下の setActiveLeaf で行う（revealLeaf はタブの見出しを光らせるので使わない）
			if (openState?.eState) leaf.setEphemeralState(openState.eState);
		} else {
			// 行き先のタイルの末尾に新しいタブを作る。一時的に別のタブをアクティブにすると、
			// そのタブが一瞬ハイライトされるので、getLeaf('tab') は使わない。
			leaf = dest
				? workspace.createLeafInParent(
						dest,
						leaves.filter((l) => l.parent === dest).length,
					)
				: workspace.createLeafBySplit(this, 'vertical');
			await original.call(leaf, file, openState);
		}

		// 開いたタブを前に出すのは、そう頼まれたときか、元のタブがアクティブだったとき
		if (show) {
			workspace.setActiveLeaf(leaf, { focus: true });
		} else if (recent) {
			workspace.setActiveLeaf(recent, { focus: false });
		}

		// 位置の修正: 行き先でないタイルで同じファイルを出しているタブと、空のまま残った元のタブを閉じる
		for (const l of leaves) {
			if (l.parent === dest) continue;
			if (shows(l, file) || (l === this && l.view.getViewType() === 'empty')) l.detach();
		}
	};

	WorkspaceLeaf.prototype.openFile = openFile;
	return () => {
		enabled = false;
		// 後から他のプラグインが差し替えていたら、それを壊さないよう素通しのまま残す
		if (WorkspaceLeaf.prototype.openFile === openFile) WorkspaceLeaf.prototype.openFile = original;
	};
}
