# Daily Logging（Obsidian プラグイン）

新しいファイルの作成と、タスクの開始・中断・終了を、時刻とリンク付きでデイリーノートに記録する。
利用者向けの説明は @README.md を参照。

## コマンド

- コードを変えたら、次の順で確かめる。どこかで失敗したら、直してから先へ進む
  1. `npm run lint`
  2. `npm run build`（tsc の型チェックを含む）
  3. `obsidian dev:debug on`（`dev:console` はデバッガーを接続しないと使えない）
  4. `obsidian dev:errors clear` と `obsidian dev:console clear`
  5. `obsidian plugin:reload id=daily-logging`
  6. `obsidian dev:errors` と `obsidian dev:console level=error` で、エラーが出ていないか見る
- `npm run dev` は監視モード。ユーザーが別のターミナルで動かすので、実行しない
- 読み込みのエラーまでは上の手順で確かめる。操作しての動作確認はユーザーが行うので、変更ごとに確認手順を短く示す
- 実行してよいコマンド、確認が必要なコマンド、禁止するコマンドは `.claude/settings.json` を参照
- そこにないコマンドを実行するときは、`.claude/settings.json` に追加するかどうかもユーザーに確認する

## 構成

- `src/main.ts`: プラグイン本体。イベント登録、記録キュー、タスクの開始・終了・中断、コマンド
- `src/daily-notes.ts`: Daily notes コアプラグインの非公開 API を触るのはこのファイルだけ。`reportError` と `NO_DAILY_NOTES_MESSAGE` もここ
- `src/time-slots.ts`: 時間帯の解析、論理上の日付、見出しの下への挿入（Obsidian に依存しない）
- `src/task.ts`: タスクのプロパティの読み取り、表示条件、グループ、並び順、所要時間
- `src/task-view.ts`: 右サイドバーのタスク一覧
- `src/calendar.ts`: GAS ウェブアプリからの予定の取得と、予定のファイルの作成・更新
- `src/settings.ts`: 設定（宣言的設定 API `getSettingDefinitions()` を使う。`display()` は使わない）

## 方針

- `minAppVersion` は 1.13.2（宣言的設定 API と、その `secret` コントロールのため）
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
- 予定日を過ぎたタスクは、周期に関係なく、終了して予定日時が空になるまで表示し続ける
- 終了すると、予定日時の値を空にする（プロパティ自体は消さない。未来の予定日時でも空にする）。中断すると、予定日時を「今から resumeMinutes 分後」にする（日付をまたいでもよい）
- 開始すると終了日時の値を空にする（プロパティがあるときだけ。なければ作らない）。同じ分に終了と開始をしても、実行中と判定できるようにするため
- 所要時間は常に `(HH:mm)` 形式で書く。24時間を超えても繰り上げない（例 `25:10`）。表記の設定は作らない
- タスクの開始・中断・終了を記録したら、デイリーノートを表示し、追記した行の末尾にカーソルを置く。開いているタブがあればそれを使い、なければ新しいタブで開く。ボタンでもコマンドでも同じ。設定でオフにできる
- 予定は `~/Documents/FetchEvents` の GAS ウェブアプリから取得する（`token` と、翌日の時刻 `until` を渡す。仕様はそちらの AGENTS.md）。トークンは SecretStorage に入れ、`data.json` にはキー名だけを置く
- 予定ごとに、保管庫直下の同名ファイルを使う（なければ作る）。予定日時と場所のプロパティは毎回上書きする（実行中のタスクでも）。説明は Markdown のリンクや改行を含むので、プロパティではなく本文の末尾に追記する。同じ説明がすでに本文にあれば追記しない
- 予定は、1日の区切りの N 分前（既定15分）に、保管庫が開いていれば取得する。その時刻に開いていなかった日は取得しない（取り逃しは補わない）
- コマンドは最小限にする（一覧を開く、開始、終了、中断、予定の取得）。条件に合うときだけ実行できる。プロパティがない Markdown ファイルでも開始できる
- 同じタスクを二重に開始することはない前提

## Git

- 変更はできるだけ細かい単位でコミットする。1コミットで1つの目的にする
- コミットする前に `git diff` を見せて、ユーザーの確認を取る
- push、タグ付け、リリース（`npm version`、`gh release`）はユーザーが行う
- タグには `v` を付けない（`.npmrc` に `tag-version-prefix=""` を設定済み）。`release.yml` はリリースを下書きで作るので、公開するには `gh release edit <version> --draft=false` が必要
