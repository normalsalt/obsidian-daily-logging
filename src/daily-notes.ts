import { Notice, TFile, TFolder, moment, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { Inserted } from './time-slots';

type Moment = ReturnType<typeof moment>;

const DEFAULT_FORMAT = 'YYYY-MM-DD';

// コアプラグイン「デイリーノート」の非公開 API（Obsidian 1.14 で動作確認）
// 予告なく変わる可能性があるため、このファイルの外からは直接触らない。
// 戻り値の型は保証されないので、unknown で受けてから確認する。
export interface DailyNotesInstance {
	options?: unknown;
	getFolder(): unknown;
	getFormat(): unknown;
	getDailyNote(date: Moment): Promise<TFile | null | undefined>;
}

/** 有効なデイリーノートのインスタンスを返す。無効、または API が変わっていれば null */
export function getDailyNotes(app: App): DailyNotesInstance | null {
	const internal = (app as unknown as {
		internalPlugins?: { getEnabledPluginById(id: string): unknown };
	}).internalPlugins;
	const dn = internal?.getEnabledPluginById('daily-notes') as
		| Partial<DailyNotesInstance>
		| null
		| undefined;
	if (
		dn &&
		typeof dn.getFolder === 'function' &&
		typeof dn.getFormat === 'function' &&
		typeof dn.getDailyNote === 'function'
	) {
		// フォルダが判定できない形に変わっていたら、使えないものとして扱う
		try {
			folderOf(dn as DailyNotesInstance);
		} catch {
			return null;
		}
		return dn as DailyNotesInstance;
	}
	return null;
}

/** { folder: '...' } の形のオブジェクトから folder を取り出す */
function folderProp(value: unknown): unknown {
	return typeof value === 'object' && value !== null && 'folder' in value
		? value.folder
		: undefined;
}

/** 保存先フォルダのパス（ルートなら ''）を返す */
function folderOf(dn: DailyNotesInstance): string {
	const raw = dn.getFolder();
	const rawProp = folderProp(raw);
	const optionsProp = folderProp(dn.options);
	let folder: string;

	if (typeof raw === 'string') {
		folder = raw;
	} else if (raw instanceof TFolder) {
		folder = raw.path;
	} else if (typeof rawProp === 'string') {
		folder = rawProp; // 実際に確認できた形 { folder: '...' }
	} else if (typeof optionsProp === 'string') {
		folder = optionsProp;
	} else if (raw === undefined || raw === null || rawProp === undefined) {
		folder = ''; // 未設定ならルート
	} else {
		throw new Error('Could not determine the daily notes folder.');
	}

	folder = normalizePath(folder.trim());
	return folder === '/' ? '' : folder;
}

/** 日付の形式（未設定なら YYYY-MM-DD）を返す */
function formatOf(dn: DailyNotesInstance): string {
	const format = dn.getFormat();
	return typeof format === 'string' && format.trim() !== '' ? format : DEFAULT_FORMAT;
}

/** デイリーノート（保存先フォルダ内で、日付の形式に一致するノート）かどうか */
export function isDailyNote(file: TFile, dn: DailyNotesInstance): boolean {
	if (file.extension !== 'md') return false;
	const folder = folderOf(dn);
	if (folder && !file.path.startsWith(`${folder}/`)) return false;
	const rel = (folder ? file.path.slice(folder.length + 1) : file.path).replace(/\.md$/, '');
	return moment(rel, formatOf(dn), true).isValid();
}

/** デイリーノートに追記した場所 */
export interface LoggedLine {
	file: TFile;
	line: number; // 0から
	text: string; // 追記した行の内容
}

/** 指定日のデイリーノートを取得（なければテンプレート付きで作成）し、1行追記する */
export async function updateDailyNote(
	app: App,
	dn: DailyNotesInstance,
	date: Moment,
	update: (data: string, dailyNote: TFile) => Inserted,
): Promise<LoggedLine> {
	const dailyNote = await dn.getDailyNote(date);
	if (!(dailyNote instanceof TFile)) {
		throw new Error('Could not get the daily note.');
	}
	let line = 0;
	let text = '';
	await app.vault.process(dailyNote, (data) => {
		const inserted = update(data, dailyNote);
		line = inserted.line;
		text = inserted.data.split('\n')[line] ?? '';
		return inserted.data;
	});
	return { file: dailyNote, line, text };
}

/** 末尾に1行追記する */
export function appendLine(data: string, line: string): Inserted {
	const sep = data === '' || data.endsWith('\n') ? '' : '\n';
	const before = `${data}${sep}`;
	return { data: `${before}${line}\n`, line: before.split('\n').length - 1 };
}

/** Daily notes コアプラグインが使えないときのメッセージ（無効なときと、非公開 API が変わったときの両方） */
export const NO_DAILY_NOTES_MESSAGE =
	"Daily Logging couldn't use the Daily notes core plugin. Make sure it is enabled.";

/** エラーを通知し、詳細は開発者コンソールに出す */
export function reportError(err: unknown): void {
	console.error('[Daily Logging]', err);
	const detail = err instanceof Error ? err.message : String(err);
	new Notice(`Daily Logging: ${detail} See the developer console for details.`);
}
