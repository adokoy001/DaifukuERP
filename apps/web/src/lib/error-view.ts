// Human-first presentation of thrown values (ui-kit AC-8/AC-9): what happened and what to do first, the technical
// code / HTTP status / hint second. No information is dropped; only the order and emphasis change.
import { isApiError } from '../api/client.ts';
import type { Label } from '../api/types.ts';

export interface ErrorView {
  /** The server's (or runtime's) message. */
  message: string;
  /** Localized explanation chosen from the error code / transport failure. */
  explanation?: Label;
  code?: string;
  /** HTTP status; 0 means the request never reached the API. */
  status?: number;
  hint?: string;
}

const EXPLANATIONS: Record<string, Label> = {
  NETWORK: {
    ja: 'サーバーに接続できませんでした。通信状況を確認して、もう一度お試しください。',
    en: 'Could not reach the server. Check your connection and try again.',
  },
  PERMISSION_DENIED: {
    ja: '現在の会社・権限では利用できません。必要な場合は管理者に権限を確認してください。',
    en: 'This is not available for your current company or role. Ask an administrator if you need access.',
  },
  NOT_FOUND: {
    ja: '対象が見つかりませんでした。削除されたか、別の会社の記録の可能性があります。',
    en: 'The item was not found. It may have been deleted or belong to another company.',
  },
  CONFLICT: {
    ja: '他の更新と競合しました。最新の内容を読み込んでから、もう一度お試しください。',
    en: 'This conflicts with another update. Reload the latest data and try again.',
  },
  VALIDATION: { ja: '入力内容を確認してください。', en: 'Check the entered values.' },
  INVALID_STATE: {
    ja: '現在の状態ではこの操作を実行できません。',
    en: 'This cannot be done in the current state.',
  },
  HAS_DEPENDENTS: {
    ja: '関連する記録があるため実行できません。',
    en: 'Related records prevent this operation.',
  },
  INTERNAL: {
    ja: '一時的な問題が発生した可能性があります。時間をおいて再試行してください。',
    en: 'A temporary problem may have occurred. Try again in a moment.',
  },
};

/** Explanation for an API error code; status 0 (transport failure) is explained as a connection problem. */
export function errorExplanation(code: string | undefined, status: number | undefined): Label | undefined {
  if (status === 0) return EXPLANATIONS.NETWORK;
  return code ? EXPLANATIONS[code] : undefined;
}

export function describeError(error: unknown): ErrorView {
  if (isApiError(error)) {
    const view: ErrorView = { message: error.message || error.code, code: error.code, status: error.status };
    const explanation = errorExplanation(error.code, error.status);
    if (explanation) view.explanation = explanation;
    if (error.hint) view.hint = error.hint;
    return view;
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

export interface ErrorToast {
  kind: 'error';
  title: string;
  message?: string;
  code?: string;
}

/** Toast content for a thrown value: the human message as title, the hint next, the code as secondary text. */
export function toastFromError(error: unknown, fallbackTitle: string): ErrorToast {
  if (isApiError(error)) {
    const toast: ErrorToast = { kind: 'error', title: error.message || error.code, code: error.code };
    if (error.hint) toast.message = error.hint;
    return toast;
  }
  return { kind: 'error', title: fallbackTitle, message: error instanceof Error ? error.message : String(error) };
}
