import { useState } from 'react';
import { saveAccountingProfileInput, type AccountingProfile, type FilingBoard } from '@daifuku/mod-tax-filing/contract';
import { useFinanceCommand } from '../api/finance.ts';
import { useLocale } from '../i18n.tsx';
import { FinanceDialog, FinanceField, FinanceNotice } from './finance-shared.tsx';

export function FilingAccountingProfile({
  board,
  stale,
  onClose,
}: {
  board: FilingBoard;
  stale: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale(),
    command = useFinanceCommand(),
    current = board.accountingProfile;
  const [profileCode, setProfileCode] = useState(current?.countryProfile ?? board.profiles[0]?.code ?? '');
  const [mapping, setMapping] = useState<Record<string, AccountingProfile['mappings'][number]>>(
    Object.fromEntries((current?.mappings ?? []).map((row) => [row.accountId, row])),
  );
  const profile = board.profiles.find((row) => row.code === profileCode);
  return (
    <FinanceDialog
      title={t({ ja: '財務諸表の作成条件・科目対応', en: 'Financial statement profile and account mapping' })}
      submitLabel={t({ ja: '確認した対応を保存', en: 'Save reviewed mapping' })}
      stale={stale}
      submitDisabled={board.truncated || !profile}
      onClose={onClose}
      onSubmit={async (data) => {
        const input = saveAccountingProfileInput.parse({
          expectedVersion: current?.version ?? 0,
          countryProfile: profileCode,
          entityType: data.get('scopeConfirmed') === 'on' ? 'corporation' : '',
          accountingBasis: 'tax_exclusive',
          consolidation: 'standalone',
          legalName: String(data.get('legalName') ?? ''),
          mappings: Object.values(mapping).filter((row) => Boolean(row.category)),
          basis: String(data.get('basis') ?? ''),
        });
        await command.mutateAsync({ action: 'tax_filing.save_accounting_profile', input });
      }}
    >
      <FinanceNotice>
        {t({
          ja: '初版の公式出力は一般商工業の法人・単体・税抜帳簿による貸借対照表と損益計算書です。税目の申告書や税額計算、個別注記などの全書類を自動作成するものではありません。',
          en: 'Official export covers balance sheets and income statements for standalone general-commercial corporations using tax-exclusive books. It does not generate every tax return, tax calculation or disclosure.',
        })}
      </FinanceNotice>
      <label className="finance-field">
        <span>{t({ ja: '出力仕様', en: 'Output profile' })}</span>
        <select className="input" value={profileCode} onChange={(event) => setProfileCode(event.target.value)}>
          {board.profiles.map((row) => (
            <option key={row.code} value={row.code}>
              {row.name} · {row.version}
            </option>
          ))}
        </select>
      </label>
      <FinanceField
        label={{ ja: '法人名', en: 'Legal company name' }}
        name="legalName"
        required
        maxLength={100}
        defaultValue={current?.legalName}
      />
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead>
            <tr>
              <th>{t({ ja: '元の勘定科目', en: 'Source account' })}</th>
              <th>{t({ ja: '財務諸表での区分', en: 'Statement category' })}</th>
              <th>{t({ ja: '出力する科目名', en: 'Exported account name' })}</th>
            </tr>
          </thead>
          <tbody>
            {board.accounts.map((account) => {
              const entry = mapping[account.id];
              return (
                <tr key={account.id}>
                  <td>
                    {account.code} · {account.name}
                  </td>
                  <td>
                    <select
                      className="input"
                      aria-label={`${account.code} ${t({ ja: '区分', en: 'category' })}`}
                      value={entry?.category ?? ''}
                      onChange={(event) => {
                        const category = event.target.value;
                        setMapping((previous) => ({
                          ...previous,
                          [account.id]: {
                            accountId: account.id,
                            category,
                            displayName: previous[account.id]?.displayName ?? account.name,
                          },
                        }));
                      }}
                    >
                      <option value="">{t({ ja: '未設定', en: 'Not mapped' })}</option>
                      {profile?.categories
                        .filter((category) => category.accountTypes.includes(account.type))
                        .map((category) => (
                          <option key={category.key} value={category.key}>
                            {category.label}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input"
                      aria-label={`${account.code} ${t({ ja: '出力名', en: 'display name' })}`}
                      value={entry?.displayName ?? account.name}
                      maxLength={100}
                      onChange={(event) => {
                        const displayName = event.target.value;
                        setMapping((previous) => ({
                          ...previous,
                          [account.id]: {
                            accountId: account.id,
                            category: previous[account.id]?.category ?? '',
                            displayName,
                          },
                        }));
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FinanceField
        label={{ ja: '科目対応の確認根拠', en: 'Mapping review evidence' }}
        name="basis"
        required
        maxLength={2000}
        defaultValue={current?.basis}
      />
      <label>
        <input type="checkbox" name="scopeConfirmed" required />
        {t({
          ja: '法人・単体・税抜帳簿の対象条件と科目対応を確認しました',
          en: 'I verified the corporation, standalone, tax-exclusive scope and account mapping',
        })}
      </label>
      {profile ? (
        <p>
          {t({ ja: '仕様の参照元', en: 'Specification sources' })}:{' '}
          {profile.sources.map((source, index) => (
            <a key={source} href={source} target="_blank" rel="noreferrer">
              {' '}
              [{index + 1}]{' '}
            </a>
          ))}
        </p>
      ) : null}
    </FinanceDialog>
  );
}
