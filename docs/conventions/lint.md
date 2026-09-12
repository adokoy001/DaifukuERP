# lint / gate

`pnpm gate` = typecheck → eslint → dependency-cruiser → vitest(unit) → vitest(db)。5分以内を維持する（超えたら分割・キャッシュを先に直す）。

| ルール | 意図 | 直し方 |
|---|---|---|
| boundaries（dependency-cruiser） | レイヤの一方向依存、他パッケージ内部への import 禁止 | 公開 index から import。逆方向はフック/イベントに |
| max-lines 400 / max-lines-per-function 80 | 単位をレビュー可能に | 責務で分割 |
| no-explicit-any / no-non-null-assertion | 型を曲げない | 絞り込み・Zod |
| parseFloat 禁止 | 金額の float 化を防ぐ | Decimal.from |
| ignorePermissions 禁止 | 権限バイパスを作らない | 適切なロールの Context |
| it.skip/test.skip 禁止 | ゲートの骨抜き防止 | 直すか削除＋記録 |
| no-console | 構造化ログへ | ctx.log |
