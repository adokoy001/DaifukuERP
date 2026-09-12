# Windows エッジサービスの依存関係とセキュリティ確認

確認日: 2026-09-13。対象は `WinSW v2.12.0 / WinSW.NET461.exe` と、このリポジトリが生成するサービス構成です。固定tagのソースとApacheの現行公開情報を照合した読取りレビューであり、依存ライブラリ全体の無脆弱性や侵入試験の合格を表すものではありません。導入手順は[付録K](../manual/edge-service-setup.md)、実OSでの測定は[作業記録](../log/2026-09-13-edge-installers.md)を参照します。

## 対象バイナリと根拠

- 配布するWinSWのSHA-256は `b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f`。公式配布先と固定hashは [assets.json](../../apps/edge/scripts/assets.json) に記録しています。
- 固定tagの [WinSW.Core.csproj](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW.Core/WinSW.Core.csproj) は log4net 2.0.12 と YamlDotNet 8.1.2 を参照します。[WinSW.csproj](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW/WinSW.csproj) ではNET461版へこれらをILMergeします。NET461版のSharpZipLibは対象外です。WinSWだけのMIT表記で済ませず、内蔵依存のLICENSE/NOTICEも [配布生成](../../apps/edge/scripts/package.py) に含めています。
- 実行に必要な.NET Framework 4.8はOS側の管理対象です。Node.jsだけを更新しても、この内蔵log4netやOSの.NETは更新されません。

## 公開アドバイザリとの照合

次表の対象版・発生条件・修正版は [Apache Logging Services Security](https://logging.apache.org/security.html) に基づきます。「版が影響範囲内」と「このサービスで該当処理を使うか」を別々に判定します。

| アドバイザリ | Apacheの対象と条件 | 当構成の判定 |
|---|---|---|
| CVE-2026-34481 | Javaの `log4j-layout-template-json`。非有限浮動小数点値を含む特定メッセージのJSON生成。 | .NETのlog4netとは別製品。このWinSW依存には該当しません。 |
| CVE-2026-40021 | log4net 3.3.0未満。`XmlLayout` / `XmlLayoutSchemaLog4J` でMDCやidentity中のXML禁止文字がログ欠落を起こす。3.3.0で修正。 | 内蔵2.0.12は影響版です。ただし次節の固定ログ構成に当該layoutはなく、今回確認したコード経路では到達しません。 |
| CVE-2018-1285 | log4net 2.0.10未満の設定読込みにおけるXML外部実体処理。 | 内蔵2.0.12はこの影響版の範囲外です。設定のアクセス制御は別途必要です。 |

## 現在使うログ処理

固定tagの [Program.cs / LoadConfigAndInitLoggers](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW/Program.cs#L658) は、`PatternLayout` を作り、通常のファイルとコンソールへ設定します。サービス実行時の [ServiceEventLogAppender](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW/Logging/ServiceEventLogAppender.cs) は `RenderedMessage` をWindows Event Logへ渡します。XMLへのログ直列化は行いません。

固定tagの製品ソース（`src` 以下、試験を除くC#・config・projectファイル）も照合し、log4net設定は上記メソッドの `BasicConfigurator` 3箇所でした。`XmlConfigurator`、XMLログlayout、ネットワーク/DB appenderや `BinaryFormatter` の呼出は確認されませんでした。これは固定tagの実装確認であり、将来版や独自プラグインの挙動には適用しません。

当アダプターが生成する [DaifukuEdge.xml](../../apps/edge/setup/windows/config.ts) は、WinSWの実行ファイル・引数・アカウントなどを指定する**サービス設定XML**です。[XmlServiceConfig](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW.Core/Configuration/XmlServiceConfig.cs) が読む設定形式であり、CVE-2026-40021の**XMLログlayout**ではありません。したがって「XMLを管理者所有にしたからXMLログの問題が修正された」という説明にはしません。

## この判定を支える導入境界

- [Windows ACL処理](../../apps/edge/setup/windows/paths-script.ts) は、コード・サービス設定・登録控えをAdministrators/SYSTEM管理とし、LocalServiceへ書込みを与えません。ローカルパスを検査し、共有パスとreparse pointを拒否します。
- [サービス登録](../../apps/edge/setup/windows/service-script.ts) は導入ID、設定とwrapperのhash、実SCMのImagePath・実行アカウントを照合します。任意の既存サービスを同名だけで採用しません。設定は固定テンプレートで生成し、ジョブやHTTP応答から差し替えません。
- 引数は設定と状態のパスだけです。ペアリング入力・資格情報は保護された状態ファイルに分けます。[常駐CLI](../../apps/edge/src/main.ts) は状態コードを出力し、WinSWの起動引数へ秘密を渡しません。ただし、上流wrapperの全例外メッセージに秘密除去が備わると保証するものではありません。
- 状態とログはLocalService/SYSTEM/Administratorsの範囲です。LocalServiceはWindows共通の組込アカウントなので、別のLocalServiceサービスからの隔離は保証しません。端末管理者と同アカウントのサービスは信頼主体です。

## 残る運用上の制約と再確認条件

1. log4net 2.0.12を修正版と表示しません。依存スキャンのCVEを一括抑止せず、この固定構成についての到達性判断を保管します。wrapper更新、ログlayout変更、外部config/プラグインの追加時には再確認が必要です。
2. WinSWの子プロセスstdout/stderr用サイズローテーションと、`Program.cs` の `FileAppender` が追記する `*.wrapper.log` は別です。後者の容量上限はこの設定では保証されません。保管・ローテーションと空き容量監視は運用で管理します。
3. 平文ログを信頼できるHTMLやコマンドとして扱いません。Pattern形式に一般的なログ注入防止を期待することはできず、閲覧・転送先でも適切に扱います。[Apacheの脅威モデル](https://logging.apache.org/security.html#common-threat-model)
4. [配布manifest検査](../../apps/edge/setup/bundle.ts) は内容と期待hashを照合しますが、既に実行した同梱Node/setup自体の真正性は遡って証明できません。署名・公証未対応のため、信頼する別経路から得たアーカイブhashをOSの独立したツールで展開・実行前に照合する手順が前提です。

この範囲のレビューでは、挙げたCVEを利用した現構成への到達経路や、上記の既存前提を越える新たな公開阻害要因は確認されませんでした。未知の脆弱性、侵害済み管理者、改変した配布元、全OS/依存パッケージの網羅的監査についての安全宣言ではありません。
