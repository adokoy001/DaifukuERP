# ADR-0020: ブラウザー内シフト推薦とサーバーでの公開検証

日付: 2026-09-12。状態: accepted。仕様: [employee-shift-planner](../specs/employee-shift-planner.md)。

## 背景

社員・勤怠・有給は共通workforceに存在するが、計画シフトと勤務希望はない。業界共通で軽量に動かしたく、推薦計算のために社員情報を外部サービスへ送る必要はない。クライアント生成の割当は改ざんでき、読み取った後に休暇・希望・雇用条件も変わる。

## 決定

`workforce_site`を単位に週次計画を作る。チェーン店packの独立した店舗マスタへの暗黙の推定紐付けはしない。

純粋TypeScriptの制約検査と確率的探索を `@daifuku/mod-workforce/scheduling` から公開する。Web Workerは推薦だけを行い、ネットワーク通信・永続保存を持たない。サーバーは同じ制約検査を使うが、推薦を再計算する必要はない。純粋な公開入口とwire contractのみ依存境界の例外へ明示登録し、module全体やDBドライバをWebへ持ち込まない。

探索はseed付き貪欲初期解と焼きなまし法。禁止条件を破る状態を探索候補にせず、欠員の減少を希望・目標に対する偏りより優先する。固定した割当が不正なら勝手に外さず、解決すべき問題として返す。最適解、需要予測、法律の全適合性を保証しない。

DSLで勤務条件・本人の週次希望・計画・公開勤務を宣言する。planはentityのserverOwned状態をworkflow actionで管理する。sites権限に禁止されたdocument submitを解放しない。公開済み本文は直接編集しない。改訂は新しい下書きから公開し、旧計画をsupersededにして履歴を保つ。本人は現在公開版の自分の割当だけを読める。

保存と公開は最新の社員・希望・休暇・policy・周辺勤務を読み直す。元資料のid/versionを正規化した`sourceRevision`を比較し、社員ロックと計画ロックの内側で共有検査を行う。revisionは鮮度比較の値で、認証・権限を代替しない。欠員公開には理由と明示確認を要求する。

通常のRepository更新の事前行ロックは`FOR NO KEY UPDATE`とする。更新schemaが主キー・tenant・companyの変更を拒否するため、参照キーを保持する通常更新の排他を保ちつつ、公開処理のFK検査が取得する`KEY SHARE`と共存できる。従来の`FOR UPDATE`では「行ロック→業務advisory」と「業務advisory→FK検査」が逆順になり、社員/拠点更新と公開の間でdeadlockを起こした。削除・明示`Repository.lock`・伝票と親行のロックは従来どおり強いロックを保つ。実FKとadvisoryを使う回帰で変更前の`40P01`を再現し、変更後の成功・通常更新の版競合・明示ロックの排他を確認する。

## 帰結

サーバー常駐の数理ソルバー・WASM・外部AI・新npm依存が不要になり、ブラウザー内で停止できる。反復数と入力件数を制限し、workerの時間切れを扱う。端末ごとの速度差は残るため、合成ケースを測定して記録する。

一方で、日跨ぎ勤務、複数拠点の応援、複数希望時間帯、資格人数比率、休憩の時刻配置、需要の自動予測はこの初版に含まない。半日有給の具体的な時間帯は未定義なので申請日全体を推薦から除く。既存給与policyの通常時間閾値を保守的な計画上限として使い、残業計画や法定休日の認定は行わない。

## 参考

- [MDN: Web Workersの作成・メッセージ・終了](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)（2026-09-12確認）
- [Thompson, 1996: A simulated-annealing heuristic for shift scheduling using non-continuously available employees](https://www.sciencedirect.com/science/article/pii/0305054895000127)（書誌・抄録を2026-09-12確認。発表結果を本実装の性能と混同しない）
