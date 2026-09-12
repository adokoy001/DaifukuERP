import { useCommerceCopy } from './commerce-copy.ts';
import { useState } from 'react';
import { useCommerceTask, type CompanySource, type GroupAdjustment, type GroupBoard, type GroupMapping } from '../api/commerce.ts';
import { CommerceDialog, CommerceMoney } from './commerce-shared.tsx';
const types = [{ value: 'asset', label: '資産' }, { value: 'liability', label: '負債' }, { value: 'equity', label: '純資産' }, { value: 'revenue', label: '収益' }, { value: 'expense', label: '費用' }];
export function defaultGroupMapping(sources: CompanySource[]): GroupMapping[] { return sources.flatMap((s) => s.rows.map((row) => ({ companyId: s.companyId, accountId: row.accountId, groupCode: row.code, groupName: row.name, groupType: row.type as GroupMapping['groupType'] }))); }
export function CommerceGroupEditor({ sources, from, to, initial, stale, onClose, onSaved }: {
    sources: CompanySource[];
    from: string;
    to: string;
    initial?: GroupBoard;
    stale: boolean;
    onClose: () => void;
    onSaved: (id: string) => void;
}) {
    const copy = useCommerceCopy();
    const [mapping, setMapping] = useState(() => initial?.mapping ?? defaultGroupMapping(sources)), [adjustments, setAdjustments] = useState<GroupAdjustment[]>(() => initial?.adjustments ?? []), task = useCommerceTask();
    const updateMap = (index: number, patch: Partial<GroupMapping>) => setMapping((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
    return <CommerceDialog title={initial ? copy("連結精算表の下書きを編集") : copy("会社別科目を対応付けて連結下書きを作成")} description={copy("単体帳簿は変更しません。金額は保存時にサーバーで再取得・計算され、確定前に結果を確認できます。")} submitLabel={copy("照合資料と下書きを保存")} stale={stale} onClose={onClose} onSubmit={async (data) => { const saved = await task.mutateAsync({ action: 'group_accounting.prepare', input: { ...(initial ? { runId: initial.id } : {}), expectedVersion: initial?.version ?? 0, name: String(data.get('name') ?? '').trim(), companyIds: sources.map((s) => s.companyId), from, to, mapping, adjustments, reviewBasis: String(data.get('reviewBasis') ?? '').trim() } }); onSaved(saved.id); }}>
 <div className="commerce-form"><label>{copy("精算表の名前")}<input className="input" name="name" required maxLength={100} defaultValue={initial?.name ?? copy("") + from.slice(0, 7) + copy(" 連結精算表")}/></label><label>{copy("対象期間")}<input className="input" value={`${from} ～ ${to}`} readOnly/></label></div>
 <div className="commerce-step">{copy("01 · 科目の対応付け")}</div><p className="commerce-notice">{copy("各社の勘定科目を連結科目へ対応付けます。同じ連結コードには同じ名称・分類を指定してください。借方残は正、貸方残は負で表示します。")}</p>
 <div className="commerce-table-wrap"><table className="commerce-table"><thead><tr><th>{copy("会社 / 単体科目")}</th><th>{copy("単体残高")}</th><th>{copy("連結コード")}</th><th>{copy("連結科目名")}</th><th>{copy("分類")}</th></tr></thead><tbody>{mapping.map((row, index) => { const source = sources.find((s) => s.companyId === row.companyId), account = source?.rows.find((r) => r.accountId === row.accountId), label = `${source?.code ?? ''} ${account?.code ?? ''}`; return <tr key={row.companyId + row.accountId}><td>{source?.name}<br />{account?.code} · {account?.name}</td><td className="money"><CommerceMoney value={account?.closingBalance}/></td><td><input aria-label={copy("") + label + copy(" 連結コード")} className="input" required maxLength={40} value={row.groupCode} onChange={(e) => updateMap(index, { groupCode: e.target.value })}/></td><td><input aria-label={copy("") + label + copy(" 連結科目名")} className="input" required maxLength={100} value={row.groupName} onChange={(e) => updateMap(index, { groupName: e.target.value })}/></td><td><select aria-label={copy("") + label + copy(" 分類")} className="input" value={row.groupType} onChange={(e) => updateMap(index, { groupType: e.target.value as GroupMapping['groupType'] })}>{types.map((t) => <option value={t.value} key={t.value}>{copy(t.label)}</option>)}</select></td></tr>; })}</tbody></table></div>
 <div className="commerce-step">{copy("02 · 消去と調整")}</div><CommerceAdjustments mapping={mapping} rows={adjustments} onChange={setAdjustments}/>
 <label>{copy("連結範囲・根拠資料・確認事項")}<textarea className="input" name="reviewBasis" rows={3} required maxLength={2000} defaultValue={initial?.reviewBasis ?? ''} placeholder={copy("対象会社の判断、内部取引照合表、調整の承認記録など")}/></label>
 </CommerceDialog>;
}
function CommerceAdjustments({ mapping, rows, onChange }: {
    mapping: GroupMapping[];
    rows: GroupAdjustment[];
    onChange: (rows: GroupAdjustment[]) => void;
}) {
    const copy = useCommerceCopy();
    const groups = [...new Map(mapping.map((row) => [row.groupCode, row])).values()];
    const update = (index: number, patch: Partial<GroupAdjustment>) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
    return <div className="commerce-detail">{rows.map((row, index) => <article className="commerce-adjustment" key={row.key}><div className="commerce-adjustment-head"><label>{copy("区分")}<select className="input" value={row.kind} onChange={(e) => update(index, { kind: e.target.value as GroupAdjustment['kind'] })}><option value="elimination">{copy("内部取引の消去")}</option><option value="adjustment">{copy("連結修正")}</option></select></label><label>{copy("摘要・根拠")}<input className="input" required maxLength={500} value={row.description} onChange={(e) => update(index, { description: e.target.value })}/></label><button type="button" className="btn" data-draft-change onClick={() => onChange(rows.filter((_, i) => i !== index))}>{copy("この調整を削除")}</button></div>
 <div className="commerce-table-wrap"><table className="commerce-table"><thead><tr><th>{copy("連結科目")}</th><th>{copy("借方（円）")}</th><th>{copy("貸方（円）")}</th><th /></tr></thead><tbody>{row.lines.map((line, li) => { const change = (patch: Partial<typeof line>) => update(index, { lines: row.lines.map((l, i) => i === li ? { ...l, ...patch } : l) }); return <tr key={li}><td><select aria-label={copy("調整") + (index + 1) + copy(" 行") + (li + 1) + copy(" 科目")} className="input" required value={line.groupCode} onChange={(e) => change({ groupCode: e.target.value })}><option value="">{copy("選択してください")}</option>{groups.map((g) => <option value={g.groupCode} key={g.groupCode}>{g.groupCode} · {g.groupName}</option>)}</select></td><td><input aria-label={copy("調整") + (index + 1) + copy(" 行") + (li + 1) + copy(" 借方")} className="input" inputMode="numeric" pattern="[0-9]+" required value={line.debit} onChange={(e) => change({ debit: e.target.value })}/></td><td><input aria-label={copy("調整") + (index + 1) + copy(" 行") + (li + 1) + copy(" 貸方")} className="input" inputMode="numeric" pattern="[0-9]+" required value={line.credit} onChange={(e) => change({ credit: e.target.value })}/></td><td><button className="btn" type="button" data-draft-change disabled={row.lines.length <= 2} onClick={() => update(index, { lines: row.lines.filter((_, i) => i !== li) })}>{copy("行削除")}</button></td></tr>; })}</tbody></table></div><button type="button" className="btn" data-draft-change disabled={row.lines.length >= 100} onClick={() => update(index, { lines: [...row.lines, { groupCode: '', debit: '0', credit: '0' }] })}>{copy("仕訳行を追加")}</button></article>)}
 <button type="button" className="btn" data-draft-change disabled={rows.length >= 200} onClick={() => onChange([...rows, { key: crypto.randomUUID(), kind: 'elimination', description: '', lines: [{ groupCode: '', debit: '0', credit: '0' }, { groupCode: '', debit: '0', credit: '0' }] }])}>{copy("＋ 消去・調整を追加")}</button><small>{copy("各調整の借方・貸方が一致する必要があります。推測した資本連結・税効果等は自動生成しません。")}</small></div>;
}
