import { useState } from 'react';
import { bankAccountInput, bankPayeeInput, type BankBoard } from '@daifuku/mod-banking/contract';
import { useFinanceCommand } from '../api/finance.ts';
import { useLocale } from '../i18n.tsx';
import { FinanceDialog, FinanceField, FinanceRef, FinanceNotice } from './finance-shared.tsx';

type Account = BankBoard['accounts'][number];
type Payee = BankBoard['payees'][number];
export type BankingEdit = { type: 'account'; row?: Account } | { type: 'payee'; row?: Payee };

function IdentityFields({ row }: { row: Account | Payee | undefined }) {
  const { t } = useLocale();
  return (
    <div className="finance-form-grid">
      <FinanceField
        label={{ ja: '銀行コード（4桁）', en: 'Bank code (4 digits)' }}
        name="bankCode"
        required
        pattern="[0-9]{4}"
        inputMode="numeric"
        defaultValue={row?.bankCode}
      />
      <FinanceField
        label={{ ja: '支店コード（3桁）', en: 'Branch code (3 digits)' }}
        name="branchCode"
        required
        pattern="[0-9]{3}"
        inputMode="numeric"
        defaultValue={row?.branchCode}
      />
      <label className="finance-field">
        <span>{t({ ja: '預金種目', en: 'Account type' })}</span>
        <select className="input" name="accountType" defaultValue={row?.accountType ?? 'ordinary'}>
          <option value="ordinary">{t({ ja: '普通', en: 'Ordinary' })}</option>
          <option value="current">{t({ ja: '当座', en: 'Current' })}</option>
        </select>
      </label>
      <FinanceField
        label={{ ja: '口座番号（1～7桁）', en: 'Account number (1–7 digits)' }}
        name="accountNumber"
        required
        pattern="[0-9]{1,7}"
        inputMode="numeric"
        autoComplete="off"
      />
      <FinanceField
        label={{ ja: '口座名義（半角英数カナ）', en: 'Holder name (half-width kana / Latin)' }}
        name="holderKana"
        required
        maxLength={30}
        defaultValue={row?.holderKana}
      />
      <label className="finance-field">
        <span>{t({ ja: '利用状態', en: 'Availability' })}</span>
        <select className="input" name="active" defaultValue={row?.active === false ? 'false' : 'true'}>
          <option value="true">{t({ ja: '有効', en: 'Active' })}</option>
          <option value="false">{t({ ja: '無効', en: 'Inactive' })}</option>
        </select>
      </label>
    </div>
  );
}

export function BankingAccountForm({
  edit,
  stale,
  onClose,
}: {
  edit: BankingEdit;
  stale: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const command = useFinanceCommand();
  const row = edit.row;
  const [reference, setReference] = useState(
    edit.type === 'account' ? (edit.row?.ledgerAccountId ?? '') : (edit.row?.partnerId ?? ''),
  );
  return (
    <FinanceDialog
      title={t(
        edit.type === 'account'
          ? { ja: '自社の銀行口座', en: 'Company bank account' }
          : { ja: '振込先口座', en: 'Payee bank account' },
      )}
      submitLabel={t({ ja: '口座情報を確認して保存', en: 'Confirm and save account' })}
      stale={stale}
      onClose={onClose}
      onSubmit={async (data) => {
        const values = Object.fromEntries(data.entries());
        delete values.referenceSearch;
        delete values.reference;
        const common = {
          ...values,
          active: values.active === 'true',
          ...(row ? { id: row.id, expectedVersion: row.version } : {}),
        };
        const input =
          edit.type === 'account'
            ? bankAccountInput.parse({ ...common, ledgerAccountId: reference })
            : bankPayeeInput.parse({ ...common, partnerId: reference });
        await command.mutateAsync({
          action: edit.type === 'account' ? 'banking.save_account' : 'banking.save_payee',
          input,
        });
      }}
    >
      {row ? (
        <FinanceNotice>
          {t({
            ja: `現在の番号は ${row.accountNumberMasked} です。変更時は確認した口座番号を再入力してください。`,
            en: `The current number is ${row.accountNumberMasked}. Re-enter the verified account number when editing.`,
          })}
        </FinanceNotice>
      ) : null}
      {edit.type === 'account' ? (
        <div className="finance-form-grid">
          <FinanceField
            label={{ ja: '口座管理コード', en: 'Account reference code' }}
            name="code"
            required
            maxLength={30}
            defaultValue={edit.row?.code}
          />
          <FinanceField
            label={{ ja: '表示名', en: 'Display name' }}
            name="name"
            required
            maxLength={100}
            defaultValue={edit.row?.name}
          />
          <FinanceField
            label={{ ja: '振込依頼人コード（10桁）', en: 'Transfer requester code (10 digits)' }}
            name="requesterCode"
            required
            pattern="[0-9]{10}"
            inputMode="numeric"
            defaultValue={edit.row?.requesterCode}
          />
        </div>
      ) : null}
      <FinanceRef
        label={
          edit.type === 'account'
            ? { ja: '預金の勘定科目', en: 'Bank ledger account' }
            : { ja: '取引先', en: 'Partner' }
        }
        entity={edit.type === 'account' ? 'account' : 'partner'}
        name="reference"
        value={reference}
        onChange={setReference}
      />
      <IdentityFields row={row} />
    </FinanceDialog>
  );
}
