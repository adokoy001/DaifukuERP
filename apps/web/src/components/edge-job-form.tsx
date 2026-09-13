import { useRef, useState } from 'react';
import { enqueueEdgeJobInput, type EdgeJobRequest } from '@daifuku/mod-edge-integration/contract';
import type { EdgeRow } from '../api/edge.ts';
import { useEdgeCommand } from '../api/edge.ts';
import { useLocale } from '../i18n.tsx';
import { edgeExpiry, edgePrintRequest } from '../lib/edge.ts';
import { EdgeForm } from './edge-form.tsx';
export function EdgeJobForm({
  device,
  serverTime,
  onClose,
}: {
  device: EdgeRow;
  serverTime: string;
  onClose: () => void;
}) {
  const { t } = useLocale(),
    task = useEdgeCommand(),
    key = useRef(crypto.randomUUID()),
    prepared = useRef<unknown>(undefined),
    [sent, setSent] = useState(false),
    [kind, setKind] = useState('print.text');
  const submit = async (data: FormData) => {
    if (!prepared.current) {
      const request: EdgeJobRequest =
        kind === 'print.text'
          ? edgePrintRequest(data)
          : kind === 'cash.dispense'
            ? { kind, payload: { amount: String(data.get('amount')), currency: 'JPY' } }
            : { kind: 'device.status', payload: {} };
      prepared.current = enqueueEdgeJobInput.parse({
        deviceId: device.id,
        idempotencyKey: key.current,
        request,
        expiresAt: edgeExpiry(serverTime, Number(data.get('minutes'))),
      });
      setSent(true);
    }
    await task.mutateAsync({ action: 'edge.enqueue', input: prepared.current });
  };
  return (
    <EdgeForm
      title={t({ ja: '機器へ処理を依頼', en: 'Request device work' })}
      submitLabel={t(
        sent ? { ja: '同じ依頼を確認', en: 'Confirm the same request' } : { ja: '処理を登録', en: 'Queue request' },
      )}
      onSubmit={submit}
      onClose={onClose}
    >
      <p className="edge-callout">
        <strong>{String(device.name)}</strong> · {String(device.localDeviceId)}
      </p>
      {sent ? (
        <p role="status" className="edge-callout">
          {t({
            ja: '送信後は内容を固定します。応答が不明な場合も同じ依頼IDで確認し、重複登録を防ぎます。新しく依頼する前に一覧の結果を確認してください。',
            en: 'The request is now fixed. Retrying uses the same request ID to avoid duplicates. Check the queue before creating another request.',
          })}
        </p>
      ) : null}
      <label>
        {t({ ja: '処理の種類', en: 'Operation' })}
        <select
          className="input"
          name="kind"
          value={kind}
          disabled={sent}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="print.text">{t({ ja: 'テキスト印刷', en: 'Text print' })}</option>
          <option value="device.status">{t({ ja: '機器状態の取得', en: 'Device status' })}</option>
          {device.driver === 'simulator' ? (
            <option value="cash.dispense">{t({ ja: '釣銭払い出し（模擬）', en: 'Cash dispense (simulated)' })}</option>
          ) : null}
        </select>
      </label>
      {kind === 'print.text' ? (
        <>
          <label>
            {t({ ja: '印刷名', en: 'Print title' })}
            <input
              className="input"
              name="title"
              maxLength={100}
              required
              readOnly={sent}
              defaultValue={t({ ja: '店舗からのお知らせ', en: 'Store notice' })}
            />
          </label>
          <label>
            {t({ ja: '印刷内容', en: 'Print content' })}
            <textarea className="input" name="text" rows={7} required maxLength={16000} readOnly={sent} />
          </label>
          <label>
            {t({ ja: '部数', en: 'Copies' })}
            <input
              className="input"
              name="copies"
              type="number"
              min={1}
              max={5}
              required
              defaultValue={1}
              readOnly={sent}
            />
          </label>
        </>
      ) : kind === 'cash.dispense' ? (
        <>
          <p className="edge-callout">
            {t({
              ja: 'これはシミュレーターです。実際の現金を払い出さず、会計や支払伝票も作成しません。',
              en: 'This is a simulator. It does not dispense real cash or create accounting or payment entries.',
            })}
          </p>
          <label>
            {t({ ja: '模擬払い出し額（円）', en: 'Simulated amount (JPY)' })}
            <input
              className="input"
              name="amount"
              inputMode="numeric"
              pattern="[1-9][0-9]{0,5}"
              required
              readOnly={sent}
            />
          </label>
        </>
      ) : null}
      <p className="edge-callout">
        {t({
          ja: '開始後も期限内に結果を確認できなければ要確認になります。期限は実機の動作を止めるものではありません。',
          en: 'If the outcome remains unknown at the deadline, the work requires review even after starting. The deadline does not stop the physical device.',
        })}
      </p>
      <label>
        {t({ ja: '開始期限', en: 'Start deadline' })}
        <select className="input" name="minutes" defaultValue="15" disabled={sent}>
          <option value="1">{t({ ja: '1分以内', en: 'Within 1 minute' })}</option>
          <option value="15">{t({ ja: '15分以内', en: 'Within 15 minutes' })}</option>
          <option value="60">{t({ ja: '1時間以内', en: 'Within 1 hour' })}</option>
        </select>
      </label>
    </EdgeForm>
  );
}
