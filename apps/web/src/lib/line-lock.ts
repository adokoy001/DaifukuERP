import type { Label } from '../api/types.ts';
import { S } from '../strings.ts';

/** Read-only is also used for temporary locks; describe the actual cause. */
export function lineLockReason(state: { canWrite: boolean; saving: boolean; actionBusy: boolean; conflict: boolean; frozen: boolean }): Label | undefined {
  if (state.saving) return { ja: '保存中です。完了までお待ちください', en: 'Saving. Please wait until it completes.' };
  if (state.actionBusy) return { ja: '操作を処理しています', en: 'An operation is in progress.' };
  if (state.conflict) return { ja: '競合があります。最新の記録を読み込んでください', en: 'A conflict requires reloading the latest record.' };
  if (!state.canWrite) return { ja: '閲覧モードのため明細は変更できません', en: 'Lines cannot be changed in view mode.' };
  if (state.frozen) return S.linesFrozen;
  return undefined;
}
