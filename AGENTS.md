# Daily Logging（Obsidian プラグイン）

新しいファイルの作成と、タスクの開始・中断・終了を、時刻とリンク付きでデイリーノートに記録する。
利用者向けの説明は @README.md を参照。

## コマンド

- `npm run lint` と `npm run build` は、変更のたびに両方通す（build は tsc の型チェックを含む）
- `npm run dev` は監視モード。ユーザーが別のターミナルで動かすので、実行しない
- Obsidian での動作確認はユーザーが行う。変更ごとに確認手順を短く示す
- 実行してよいコマンド、確認が必要なコマンド、禁止するコマンドは `.claude/settings.json` を参照
- そこにないコマンドを実行するときは、`.claude/settings.json` に追加するかどうかもユーザーに確認する

## 構成

- `src/main.ts`: プラグイン本体。イベント登録、記録キュー、タスクの開始・終了・中断、コマンド
- `src/daily-notes.ts`: Daily notes コアプラグインの非公開 API を触るのはこのファイルだけ。`reportError` と `NO_DAILY_NOTES_MESSAGE` もここ
- `src/time-slots.ts`: 時間帯の解析、論理上の日付、見出しの下への挿入（Obsidian に依存しない）
- `src/task.ts`: タスクのプロパティの読み取り、表示条件、グループ、並び順、所要時間
- `src/task-view.ts`: 右サイドバーのタスク一覧
- `src/settings.ts`: 設定（宣言的設定 API `getSettingDefinitions()` を使う。`display()` は使わない）

## 方針

- `minAppVersion` は 1.13.0（宣言的設定 API のため）
- UI の文字列、README、コミットメッセージは英語。UI は sentence case（eslint の `obsidianmd/ui/sentence-case`）
- コードのコメントは日本語
- 循環参照を避ける。`task-view.ts` から `main.ts` へは `import type` だけにする。共有する値は `daily-notes.ts` などに置く
- `console.error` は `reportError` の中だけで使う
- 非公開 API の戻り値は、使う前に確かめる（`unknown` で受けるか、型を付けても `instanceof` などで確認する）。使えないときは `getDailyNotes()` が `null` を返し、利用者には通知とタスク一覧の警告で知らせる
- moment は package.json の `overrides` で固定している
- 依存パッケージを追加・更新する前に相談する

## コードからは分からない仕様の決定

- 同期は Git だけを想定する（Obsidian Sync は考えない）。新しいファイルは、作成から5秒以内にこの端末で開かれたものだけを記録する。pull で入ってきたファイルを記録しないため
- 1日の区切りは0時ではなく、最初の時間帯の時刻（既定 6:00）。ただし見出しを使う設定と前日に記録する設定（`logToPreviousDay`）の両方がオンのときだけで、どちらかがオフなら0時
- 未来の予定日時があるタスクは、その日になるまで周期に関係なく表示しない
- 終了すると、予定日時が今日以前なら値を空にする（プロパティ自体は消さない。未来の予定は残す）。中断すると、予定日時を「今から resumeMinutes 分後」にする（日付をまたいでもよい）
- 開始すると終了日時の値を空にする（プロパティがあるときだけ。なければ作らない）。同じ分に終了と開始をしても、実行中と判定できるようにするため
- 所要時間は常に `(HH:mm)` 形式で書く。24時間を超えても繰り上げない（例 `25:10`）。表記の設定は作らない
- コマンドは最小限にする（一覧を開く、開始、終了、中断）。条件に合うときだけ実行できる。プロパティがない Markdown ファイルでも開始できる
- 同じタスクを二重に開始することはない前提

## Git

- 変更はできるだけ細かい単位でコミットする。1コミットで1つの目的にする
- コミットする前に `git diff` を見せて、ユーザーの確認を取る
- push、タグ付け、リリース（`npm version`、`gh release`）はユーザーが行う
- タグには `v` を付けない（`.npmrc` に `tag-version-prefix=""` を設定済み）。`release.yml` はリリースを下書きで作るので、公開するには `gh release edit <version> --draft=false` が必要
