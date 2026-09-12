# ADR-0016: 参照・書込み所有・集約・会社別パックの不変条件をkernelで保証する

- 状態: 採択（2026-09-12、共通基盤強化のユーザー指示）
- 関連: ADR-0004、0006、0007、0008、0014、0015、0017
- 受入条件: `docs/specs/foundation-kernel.md`

## 文脈

UUID単独FKは他会社を参照でき、公開更新は業務処理が管理する残高・仕訳リンクも書き換えられた。明細は通常entityでもあるため、伝票専用APIだけのfreezeや件数制限では迂回できる。並行する子変更と確定・削除は同じ集約を直列化していなかった。パックの常時ロードは会社への適用前にも必須拡張とhookを有効にしていた。

## 決定

1. entityのFKへtenant/company複合制約を追加し、会社自身の所属もFKとwithContextで確認する。Repositoryは参照先を現在scopeで検証し、存在をKEY SHAREで保護する。参照先のread権限を根拠に整合性検証を省略しない。
2. `f.*({serverOwned:true})`は管理者も含め公開入力を拒否する。モジュールは非公開の`defineWriteCapability({name,entity,fields,operations})`を保持し、`withWriteCapability`で必要な呼出しだけ包む。これは項目所有を追加するもので、操作・行権限は維持する。JSONでtokenを偽造できない。before hookでの正規値計算は従来どおり可能。rawUpdateはkernel lifecycleの非公開symbolが必須。
3. 子変更は親→子の順に行ロックを取得する。子createには親create、通常変更には親update、確定処理内では検証済みsubmit権限を要求する。子変更は親versionを増やし、まとめ保存・確定中の二重増加は抑制する。`repo.lock(id,op)`後に業務値を読む。欠損行も含む業務キーには`withLock`を使う。expectedVersionは公開更新・削除・状態遷移で照合する。
4. 明細は最大500件とし、読み出し・置換・直接追加・確定を検査する。旧データを先頭500件だけとして処理しない。所有先変更、重複ID、他伝票IDを拒否する。全体置換で一部明細だけが権限で見える場合も拒否する。取消済みは変更不可、確定明細の業務内部stampは明示capabilityで項目限定する。
5. マスク項目をwhere/order/aggregate/auditにも適用する。空ORはfalse。確定後extは変更したキーごとのallowOnSubmitが必要で、オブジェクトを空にする削除も検査する。名前付き確定が1つなら通常submitはそれを通り、複数なら明示選択を要求する。
6. outboxはFOR UPDATE SKIP LOCKEDで取得し、保存されたcompanyの文脈で配信する。全handlerとpublished更新をsavepoint内で実行し、失敗時はDB副作用を巻き戻してattemptのみ記録する。外部サービスへの送信はat-least-onceであり、購読側はevent IDを冪等キーとする。外部のexactly-onceを保証しない。
7. numeric(20,6)で丸められる入力は保存前に拒否する。tenant entityの公開出力にはcompanyId:nullを返す。ログインの同一メール複数tenantはtenantId選択が必要。bootstrapはtenantId指定時だけ冪等、未指定は新規tenantを作成する。
8. ADR-0015の「定義面は全会社で常時有効」を変更する。物理schema・登録は全体、実行時ext検証・メタ・ラベル・hook/guard/subscriberとpack専用entity/actionは会社のpacks.applied集合で制御する。applyPackは会社単位のロックを取り、seed/sampleへ内部適用scopeを渡す。保存済み値を既定値との等値から未選択と推測しない。通常は保持、forceのみ上書きする。

## 帰結・制限

- 既存データが複合FKに違反する移行は失敗させる。自動で他会社へ付け替えたり削除したりしない。
- 既存テストの「公開入力で派生値を偽装してhookで上書き」「メールだけでbootstrap再利用」「未適用packを実行」「既定値と同じ管理者設定を暗黙上書き」は旧契約として拒否期待または正規内部経路へ変更する。
- module/packコードは信頼する。ContextやSQLに触れる任意コードを敵対的pluginから隔離するsandboxではない。
- 全DBトランザクションの自動再実行はしない。複数集約を更新する業務は取得順序を統一し、必要な業務キーを先にロックする。
- 会社別ユーザー役割、業種固有の追加要件、外部サービス冪等台帳、既存不正データ修復は別途扱う。
