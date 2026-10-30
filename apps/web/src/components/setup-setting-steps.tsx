// Setup wizard steps that save company settings (docs/specs/setup-wizard.md AC-4, AC-17..AC-20): company profile,
// chart of accounts (read only), tax rates and rounding, invoice issuer and inventory. Every save is the ordinary
// PUT /meta/settings/:key through the same SettingCard as /settings (its permission check applies); each save ends with
// a fresh GET /meta/setup-status.
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useSaveSetting } from '../api/settings.ts';
import { useCompanies } from '../api/templates.ts';
import { useLocale } from '../i18n.tsx';
import { describeError, type ErrorView } from '../lib/error-view.ts';
import { helpUrl, manualBaseUrl } from '../lib/help.ts';
import { INVENTORY_GUIDE, inventoryState, issuerFromProfile, type InventoryChoice } from '../lib/setup-wizard.ts';
import { templatesApplied } from '../lib/settings-console.ts';
import { Button } from '../ui/index.ts';
import { SettingCard } from './setting-card.tsx';
import {
  effectiveValue,
  settingOf,
  SetupChecks,
  SetupSaveError,
  useDirtyKeys,
  type SetupStepProps,
} from './setup-shared.tsx';

const MANUAL_BASE = manualBaseUrl(import.meta.env.VITE_MANUAL_URL);

/** One SettingCard wired to the wizard (dirty flag, status refresh); nothing when the setting is not declared. */
function WizardSettingCard({
  props,
  settingKey,
  report,
  draftValue,
}: {
  props: SetupStepProps;
  settingKey: string;
  report: (dirty: boolean) => void;
  draftValue?: Record<string, unknown>;
}) {
  const setting = settingOf(props.settings, settingKey);
  if (!setting) return null;
  return (
    <SettingCard
      setting={setting}
      meta={props.meta}
      templatesApplied={templatesApplied(props.settings)}
      onDirtyChange={report}
      onSettled={() => void props.refresh()}
      {...(draftValue ? { draftValue } : {})}
    />
  );
}

export function CompanyProfileStep(props: SetupStepProps) {
  const { t } = useLocale();
  const dirty = useDirtyKeys(props.onDirty);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        {t({
          ja: '正式名称・所在地・連絡先・登録番号・決算月を入れます。免税事業者を選ぶと登録番号は入れられません（製品の入力規則）。決算月は次の会計年度の提案に使います。',
          en: 'Enter the legal name, address, contact details, registration number and fiscal year-end month. Choosing exempt business means no registration number (an input rule of this product). The year-end month is used to propose the fiscal year.',
        })}
      </p>
      <SetupChecks checks={props.step.checks} />
      <WizardSettingCard props={props} settingKey="company.profile" report={dirty('company.profile')} />
    </div>
  );
}

export function ChartOfAccountsStep(props: SetupStepProps) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        {t({
          ja: '初期の勘定科目表を確認します。消費税の集計には、仮受消費税（output_tax）と仮払消費税（input_tax）の役割を持つ有効な科目が要ります。この段階では何も保存しません。',
          en: 'Review the initial chart of accounts. The consumption tax summary needs active accounts with the output tax and input tax roles. This step saves nothing.',
        })}
      </p>
      <SetupChecks checks={props.step.checks} />
      <p>
        <Link to="/e/$entity" params={{ entity: 'account' }} className="ui-link" data-testid="setup-accounts-link">
          {t({ ja: '勘定科目の一覧を開く', en: 'Open the chart of accounts' })}
        </Link>
      </p>
    </div>
  );
}

export function TaxStep(props: SetupStepProps) {
  const { t } = useLocale();
  const dirty = useDirtyKeys(props.onDirty);
  return (
    <div className="flex flex-col gap-3">
      <SetupChecks checks={props.step.checks} />
      <p className="text-sm text-text-secondary">
        {t({
          ja: '消費税の端数処理は「1 つの適格請求書につき税率ごとに 1 回」です（国税庁 インボイス Q&A 問57）。切上げ・切捨て・四捨五入のどれにするかを選びます。',
          en: 'Consumption tax is rounded once per tax rate per qualified invoice (NTA invoice Q&A No. 57). Choose rounding up, down or half-up.',
        })}{' '}
        <a
          className="ui-link"
          href={helpUrl({ chapter: '03-setup.md', section: '税率' }, MANUAL_BASE)}
          hrefLang="ja"
          target="_blank"
          rel="noreferrer"
        >
          {t({ ja: 'マニュアル: 税率', en: 'Manual: tax rates (Japanese)' })}
        </a>
      </p>
      <p>
        <Link to="/e/$entity" params={{ entity: 'tax_rate' }} className="ui-link">
          {t({ ja: '税率の一覧を開く', en: 'Open the tax rates' })}
        </Link>
      </p>
      <WizardSettingCard props={props} settingKey="tax.rounding" report={dirty('tax.rounding')} />
      <WizardSettingCard props={props} settingKey="tax.price_includes_tax" report={dirty('tax.price_includes_tax')} />
    </div>
  );
}

export function InvoiceIssuerStep(props: SetupStepProps) {
  const { t } = useLocale();
  const dirty = useDirtyKeys(props.onDirty);
  const companies = useCompanies();
  const [draft, setDraft] = useState<Record<string, unknown>>();
  const companyName = companies.data?.items.find((c) => c.id === companies.data.companyId)?.name ?? '';
  const copy = () => {
    const profile = effectiveValue(settingOf(props.settings, 'company.profile'));
    setDraft(
      issuerFromProfile(
        typeof profile === 'object' && profile !== null ? (profile as Record<string, unknown>) : null,
        companyName,
      ),
    );
    props.announce(
      t({
        ja: '会社プロフィールの内容を入力欄に入れました（まだ保存していません）。',
        en: 'Copied the company profile into the fields (not saved yet).',
      }),
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <SetupChecks checks={props.step.checks} />
      <p className="text-sm text-text-secondary">
        {t({
          ja: '発行者を保存しない場合、請求書には会社プロフィール（正式名称・登録番号・住所・連絡先）が印字されます。振込先など請求書だけの情報を載せるときや、別の名義で請求するときに保存します。',
          en: 'Without an issuer, invoices print the company profile (legal name, registration number, address, contact). Save one to add invoice-only details such as bank information, or to bill under another name.',
        })}
      </p>
      <div className="flex flex-col gap-1">
        <div>
          <Button onClick={copy} data-testid="setup-issuer-copy">
            {t({ ja: '会社プロフィールから複写', en: 'Copy from the company profile' })}
          </Button>
        </div>
        <p className="text-xs text-text-muted" data-testid="setup-issuer-copy-note">
          {t({
            ja: '複写して保存すると、以後に会社プロフィールを変えても請求書には反映されません（発行者が保存されていれば、そちらがまとめて優先されます）。',
            en: 'Once saved, later changes to the company profile no longer reach invoices (a saved issuer is used as a whole instead).',
          })}
        </p>
      </div>
      <WizardSettingCard
        props={props}
        settingKey="sales.issuer"
        report={dirty('sales.issuer')}
        {...(draft ? { draftValue: draft } : {})}
      />
    </div>
  );
}

const AUTO_ISSUE = 'inventory.auto_issue_on_sales';
const AUTO_RECEIPT = 'inventory.auto_receipt_on_purchase';

export function InventoryStep(props: SetupStepProps) {
  const { t } = useLocale();
  const id = useId();
  const dirty = useDirtyKeys(props.onDirty);
  const save = useSaveSetting();
  const issue = effectiveValue(settingOf(props.settings, AUTO_ISSUE)) === true;
  const receipt = effectiveValue(settingOf(props.settings, AUTO_RECEIPT)) === true;
  const saved = inventoryState(issue, receipt);
  const [choice, setChoice] = useState<InventoryChoice | undefined>(saved === 'mixed' ? undefined : saved);
  const [error, setError] = useState<ErrorView>();
  const [busy, setBusy] = useState(false);
  const changed = choice !== undefined && choice !== saved;
  const reportChoice = dirty('choice');
  const pick = (next: InventoryChoice) => {
    setChoice(next);
    reportChoice(next !== saved);
  };
  const submit = async () => {
    if (!choice || busy) return;
    setBusy(true);
    props.onBusy(true);
    setError(undefined);
    const value = choice === 'use';
    try {
      // Two existing PUTs in a row (decision 13); a failure of the second leaves the real combination, which the
      // re-read status shows as it is.
      await save.mutateAsync({ key: AUTO_ISSUE, value });
      await save.mutateAsync({ key: AUTO_RECEIPT, value });
      reportChoice(false);
      props.announce(t({ ja: '在庫の扱いを保存しました。', en: 'Saved how inventory is handled.' }));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      props.onBusy(false);
      await props.refresh();
    }
  };
  const failing = props.step.checks.some((check) => check.status === 'fail');
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" aria-describedby={saved === 'mixed' ? `${id}-mixed` : undefined}>
        <legend className="text-sm font-semibold text-text">
          {t({ ja: '請求書から在庫を動かしますか', en: 'Should invoices move stock?' })}
        </legend>
        {saved === 'mixed' ? (
          <p id={`${id}-mixed`} className="ui-notice ui-notice-warning text-sm" data-testid="setup-inventory-mixed">
            {t({
              ja: `現在は片方だけ有効です（売上請求書から自動出庫: ${issue ? '有効' : '無効'}、仕入請求書から自動入庫: ${receipt ? '有効' : '無効'}）。どちらかを選んで保存してください。`,
              en: `Only one of them is on now (auto issue from sales invoices: ${issue ? 'on' : 'off'}, auto receipt from purchase invoices: ${receipt ? 'on' : 'off'}). Choose one and save.`,
            })}
          </p>
        ) : null}
        {(['use', 'none'] as const).map((option) => (
          <label key={option} className="flex items-start gap-2 text-sm" data-testid={`setup-inventory-${option}`}>
            <input
              type="radio"
              name={`${id}-inventory`}
              value={option}
              checked={choice === option}
              disabled={busy}
              onChange={() => pick(option)}
              className="mt-1"
            />
            <span>
              <span className="block font-semibold text-text">{t(INVENTORY_GUIDE[option].title)}</span>
              <span className="block text-text-secondary">{t(INVENTORY_GUIDE[option].description)}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-text-muted">
          {t({
            ja: '業種の例は当システムの業界テンプレートからの目安で、決まりではありません。片方だけを変えるときは会社設定の在庫タブを使います。',
            en: 'The industry examples are a rule of thumb from this system’s templates, not a rule. To change only one of the two, use the Inventory tab of the company settings.',
          })}{' '}
          <Link to="/settings" search={{ tab: 'inventory' }} className="ui-link">
            {t({ ja: '在庫タブを開く', en: 'Open the Inventory tab' })}
          </Link>
        </p>
        <div>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!changed || busy}
            aria-busy={busy || undefined}
            data-testid="setup-inventory-save"
          >
            {busy ? t({ ja: '保存中…', en: 'Saving…' }) : t({ ja: '在庫の扱いを保存', en: 'Save inventory handling' })}
          </Button>
        </div>
      </fieldset>
      {error ? <SetupSaveError view={error} /> : null}
      <SetupChecks checks={props.step.checks} />
      {saved === 'use' ? (
        <p className="ui-notice text-sm" data-testid="setup-inventory-stock-note">
          {t({
            ja: 'マイナス在庫を許可しない設定（既定）では、物品の売上請求書を確定する前に入庫が必要です。入庫伝票で在庫を受け入れるか、在庫タブでマイナス在庫を許可してください。',
            en: 'With negative stock not allowed (the default), goods must be received before a sales invoice with goods can be submitted. Receive stock with a stock entry, or allow negative stock on the Inventory tab.',
          })}{' '}
          <Link to="/e/$entity" params={{ entity: 'stock_entry' }} className="ui-link">
            {t({ ja: '入庫伝票を開く', en: 'Open stock entries' })}
          </Link>{' '}
          <Link to="/settings" search={{ tab: 'inventory' }} className="ui-link">
            {t({ ja: '在庫タブを開く', en: 'Open the Inventory tab' })}
          </Link>
        </p>
      ) : null}
      {saved === 'use' && failing ? (
        <div className="flex flex-col gap-2" data-testid="setup-inventory-warehouse">
          <p className="text-sm">
            <Link to="/e/$entity" params={{ entity: 'warehouse' }} className="ui-link">
              {t({ ja: '倉庫の一覧を開く', en: 'Open the warehouses' })}
            </Link>
          </p>
          <WizardSettingCard
            props={props}
            settingKey="inventory.default_warehouse"
            report={dirty('inventory.default_warehouse')}
          />
        </div>
      ) : null}
    </div>
  );
}
