# エッジサービス導入の一次資料

確認日: **2026-09-13**。OS導入の根拠であり、国内法制度の適合判定ではありません。

| 資料 | 採用した内容と境界 |
|---|---|
| [Apple launchd jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) / [daemon設計](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/DesigningDaemons.html) | ログインセッションに依存しないLaunchDaemon、配列のProgramArguments、専用UserName/GroupName。GUI利用を前提にしない。 |
| [Apple launchd.plist manual](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5) | systemドメイン、固定ラベル、KeepAlive、標準入出力とファイル所有。 |
| [systemd.exec](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml) | 専用User/Groupと実行環境の制限。状態以外を読み取り専用にする構成。 |
| [WinSW v2.12.0](https://github.com/winsw/winsw/releases/tag/v2.12.0) / [XML設定](https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md) | 固定wrapperとXMLでSCMへ登録し、LocalServiceで実行する。パス・アカウント・登録元を照合。 |
| [WinSW build project](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW/WinSW.csproj) / [Core project](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW.Core/WinSW.Core.csproj) | NET461配布とOS側.NET Framework 4.8を選ぶ。自己完結.NET runtimeは同梱しない。埋込log4net 2.0.12、YamlDotNet 8.1.2のLICENSE/NOTICEも保持する。 |
| [Microsoft LocalService](https://learn.microsoft.com/en-us/windows/win32/services/localservice-account) | SCMが使う組込の低権限アカウント。独自accountの作成は不要だが、この実装は同じLocalServiceを使う別サービスから秘密を隔離するものではない。 |
| [Apple chmod manual](https://github.com/apple-oss-distributions/file_cmds/blob/main/chmod/chmod.1) | POSIX modeに加えて拡張ACLを検査する。`chmod -N`は新規管理対象へ限定し、既存データのACLを無断で一括解除しない。 |
| [systemd 255のWorkingDirectory parser](https://github.com/systemd/systemd/blob/v255/src/core/load-fragment.c#L2400-L2453) | 単一pathを受け取るため外側引用符を付けない。ExecStart/ReadWritePathsの単語列とは別の規則であり、実parserで空白入りpathも検証する。 |
| [Node 22.23.2 checksums](https://nodejs.org/dist/v22.23.2/SHASUMS256.txt) | OS/CPU別アーカイブをSHA-256固定。展開するのは正確に指定した実行ファイルと全文LICENSEだけ。 |
| [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) | ubuntu-24.04/x64・ubuntu-24.04-arm、windows-2025/x64、macos-15-intel/x64・macos-15/arm64の5種類を実受入jobの対象にする。成功したOS/CPU・commitは作業記録で区別する。開発者PCへ本番サービスを導入して試験しない。 |

署名/Apple notarizationは実装していません。ハッシュ一致は完全性の検査であり、配布元の真正性には別途信頼できる配布経路が必要です。
NAT越えの通知/取得、機器protocolと物理処理の保護は [既存の機器一次資料](edge-relay-security.md) を引き継ぎます。

GitHub runner imageの[ubuntu24/20260907.300 生成処理](https://github.com/actions/runner-images/blob/ubuntu24/20260907.300/images/ubuntu/scripts/build/configure-system.sh#L12-L13)は`/opt`を0777にします。native受入では明示された使い捨てroot環境に限り、このroot所有ディレクトリ1個を非再帰で0755にしてから既定pathを試します。本番では他者が書ける祖先をそのまま拒否します。CIの準備と実導入要件を混同しません。
