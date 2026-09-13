# 整形 / lint / gate

`pnpm gate` は format:check → typecheck → ESLint → dependency-cruiser → unit → DB → deploy → docs:check → verify:assurance の順で実行する。DBテストには専用の使い捨てDBを明示する。所要時間は環境と検査対象に依存し、検査を省略して短縮しない。[検証と公開](../architecture/verification-and-release.md) も参照。

## 整形と責務の分割

`pnpm install --frozen-lockfile` 後に `pnpm format` で TypeScript / TSX / JavaScript / CSS を整形する。CIの `pnpm format:check` は書き換えず、不一致を失敗にする。エディターもリポジトリの固定版 Prettier と [.prettierrc.json](../../.prettierrc.json) / [.editorconfig](../../.editorconfig) を使う。

- 目標幅120、single quote、trailing comma、LF。目標幅は長いURL・SQL・文字列を機械的に切断する上限ではない。文字列の意味を変えて幅に合わせない。
- 処理の分割は、資料取得・検証・計算・保存・画面の節など、独立した責務があり読みやすさが改善する場合に行う。行数を満たすための細分化や複数文の圧縮はしない。
- ファイル1,000行・関数300行を超えたら警告する。空行とコメントは除く。超過だけでCIを失敗させず、複雑さ・結合・重複・変更頻度を見て分割を判断する。長い宣言的な画面や表を一律に切り分けない。
- `.test.ts` / `.spec.ts` と `scripts/**` は従来のサイズ例外を維持するが、整形対象である。test fixture/helperの通常の `.ts` はサイズ検査も受ける。新たな例外を追加して分割を避けない。
- 生成コード・ビルド成果物・第三者依存・既存のDrizzle migrationは [.prettierignore](../../.prettierignore) の対象。過去migrationのチェックサムは変更しない。
- 抽出後は引数・戻り値の型を保つ。React hookは実行条件と順序、トランザクションは認可・ロック・検査・書込順を維持する。無意味な行数合わせのラッパーを増やさない。

## 履歴の追跡

一括整形は振る舞いを変える変更と別コミットにし、その完全なSHAを [.git-blame-ignore-revs](../../.git-blame-ignore-revs) に記録する。責務分割や不具合修正は除外しない。手元で適用する場合は、このリポジトリ内で次を実行する。

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
git blame path/to/source.ts
```

`git blame --ignore-revs-file .git-blame-ignore-revs path/to/source.ts` なら設定を保存せずに使える。整形を除外しても、移動・抽出後の完全な帰属を保証するものではない。必要に応じて元ファイルの履歴と分割差分を読む。

| ルール | 意図 | 直し方 |
| --- | --- | --- |
| format:check | 1行への圧縮を防ぎ、差分を揃える | `pnpm format`、責務抽出 |
| boundaries（dependency-cruiser） | レイヤの一方向依存、他パッケージ内部への import 禁止 | 公開 index から import。逆方向はフック/イベントに |
| max-lines 1,000 / max-lines-per-function 300（warn） | 大きい処理のレビューを促す | 改善がある場合だけ責務で分割 |
| no-explicit-any / no-non-null-assertion | 型を曲げない | 絞り込み・Zod |
| parseFloat 禁止 | 金額の float 化を防ぐ | Decimal.from |
| ignorePermissions 禁止 | 権限バイパスを作らない | 適切なロールの Context |
| it.skip/test.skip 禁止 | ゲートの骨抜き防止 | 原因を直し、変更理由を記録 |
| no-console | 構造化ログへ | ctx.log |

参考（2026-09-13閲覧）: [Prettier導入](https://prettier.io/docs/install)、[printWidthの意味](https://prettier.io/docs/options)、[git blame](https://git-scm.com/docs/git-blame)。今回の受入条件は [可読性仕様](../specs/readable-source.md) に記録する。
