# 作業記録: 業界導入先とタブ認証の保護

- 担当: kernel_review ／ spec: industry-templates AC-2/4/6
- 計測: tokens=null、agent_minutes=null、human_minutes=0、rework_lines=null、gate_failures=null

## 決定・変更

- 独立レビューで、認証情報が共通localStorageにあると、別タブの別ユーザーログインで元のタブの未保存入力が別会社へ送られる経路を確認。token/userも会社選択と同じsessionStorageに移した。
- 旧localStorage認証への自動fallbackは行わない。**更新後は各タブで再ログインが必要。** 別タブのログイン状態変更を開いている画面へ持ち込まない。言語設定のlocalStorageは変更しない。
- ブラウザ履歴のBFCache復元（pageshow.persisted）時はreloadし、会社情報・メタデータ・query cacheを現在のタブの認証から読み直す。
- e2eの認証参照4箇所をsessionStorageへ移した。
- 業界デモ会社の作成時にsettings['demo.industry']=packを記録。既存codeはmarker一致時だけ再使用し、全候補をseed前に事前検査する。未markedや別packの会社を自動採用しない。保存済み会社名を保全し、返り値も実名を使う。

## 検証

- [実測] industry-ui unit 5件通過（526ms）。タブAで入力したデータを、タブBの別tenantログイン後にもAのtoken/会社宛てに送ることをfetch引数で確認。旧localStorage認証を再利用しないことも確認。
- [実測] PG16専用daifuku_review_appliancesでindustry-demo-ownership DB 3件通過（22.53秒）。未markedコード衝突、別pack marker、既存会社不変、所有デモの再利用・改名保持・元adminのdefault会社保持を確認。
- [実測] Web/API package型検査、変更ファイルESLint、diff-check通過。schema変更なし。
- [未実施] この追補単独ではBFCacheを含む実ブラウザe2eを実行していない。rootの通しUI検証と統合gateで確認する。

## 既存検証デモへの扱い

この作成処理でmarkerを付ける前に用意した会社も、自動では所有を推定しない。必要なら作成経緯を確認した検証DBの会社だけを明示的に扱う。一般の既存会社を救済処理でデモ化しない。
