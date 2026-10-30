// form-ergonomics AC-8: React side of the unsaved-input drafts (lib/form-draft.ts). While the form has unsaved
// changes the input is written to this tab's sessionStorage (debounced, and on page hide / leaving the screen); when
// the same screen opens again the draft is offered, not applied. A draft made on an older version of the record is
// dropped with a notice. Saving, discarding or undoing every change removes it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { getCompanyId, getUser } from '../api/client.ts';
import type { EntityMeta, FieldMeta } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import {
  applyDraft,
  buildDraft,
  draftKey,
  draftOffer,
  draftStorage,
  readDraft,
  removeDraft,
  writeDraft,
  type FormDraft,
} from '../lib/form-draft.ts';
import type { FormValues } from '../lib/form.ts';
import { formatTimestamp } from '../lib/format.ts';
import type { GridRow } from '../lib/lines.ts';
import { Button } from '../ui/index.ts';

const WRITE_DELAY_MS = 400;

export interface FormDraftOptions {
  entity: EntityMeta;
  /** lib/form-draft.ts draftTarget: record id, `new` or `new:<seed key>`. */
  target: string;
  /** Version of the record the form was loaded with (undefined on /new). */
  recordVersion: number | undefined;
  /** False for viewers: nothing is kept or offered when the user cannot save. */
  enabled: boolean;
  specs: readonly { line: EntityMeta; columns: FieldMeta[] }[];
  values: FormValues;
  lines: Record<string, GridRow[]>;
  baseValues: FormValues;
  baseLines: Record<string, GridRow[]>;
  dirty: boolean;
  onRestore: (values: FormValues, lines: Record<string, GridRow[]>) => void;
}

export interface FormDraftControl {
  offer: FormDraft | null;
  stale: boolean;
  /** The last write reached the storage (the leave confirmation then says the input is kept). */
  kept: boolean;
  restore: () => void;
  discard: () => void;
  dismissStale: () => void;
  /** After a successful save: remove the draft and keep the pre-save input from being written back. */
  clear: () => void;
}

export function useFormDraft(options: FormDraftOptions): FormDraftControl {
  const { entity, target, recordVersion, enabled } = options;
  const key = useMemo(() => {
    const user = getUser();
    const scope = { tenantId: user?.tenantId ?? '', userId: user?.id ?? '', companyId: getCompanyId() ?? '' };
    return enabled ? draftKey(scope, entity.name, target) : undefined;
  }, [entity.name, target, enabled]);
  const [offer, setOffer] = useState<FormDraft | null>(null);
  const [stale, setStale] = useState(false);
  const [kept, setKept] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  const pendingOffer = useRef(false);
  pendingOffer.current = offer !== null;
  /** The values/lines objects at the last clear(): no edit since, so nothing to write. */
  const cleared = useRef<{ values: FormValues; lines: Record<string, GridRow[]> } | null>(null);

  // Read once per screen (the form is keyed by record id / seed): offer it, or drop it when the record moved on. The
  // version is the one this form instance was opened with (a ref), so a later refetch does not re-run the read.
  const openedVersion = useRef(recordVersion);
  useEffect(() => {
    if (!key) return;
    const storage = draftStorage();
    const draft = readDraft(storage, key, entity.name, target, Date.now());
    if (!draft) return;
    if (draftOffer(draft, openedVersion.current) === 'offer') setOffer(draft);
    else {
      removeDraft(storage, key);
      setStale(true);
    }
  }, [key, entity.name, target]);

  // `leaving`: page hide / unmount only add a draft and never remove one. React StrictMode runs an unmount right
  // after the first mount, before the offer state of a stored draft is rendered; removing there lost the draft.
  const write = useRef((_leaving?: boolean) => {});
  write.current = (leaving = false) => {
    const o = latest.current;
    if (!key || pendingOffer.current || (leaving && !o.dirty)) return;
    if (cleared.current && cleared.current.values === o.values && cleared.current.lines === o.lines) return;
    const storage = draftStorage();
    const draft = o.dirty
      ? buildDraft({
          entity: o.entity,
          target: o.target,
          baseVersion: o.recordVersion ?? null,
          now: new Date().toISOString(),
          values: o.values,
          baseline: o.baseValues,
          lines: o.lines,
          baselineLines: o.baseLines,
          specs: o.specs,
        })
      : undefined;
    if (!draft) {
      removeDraft(storage, key);
      setKept(false);
      return;
    }
    setKept(writeDraft(storage, key, draft));
  };

  // Typing while a draft is offered means "start over": the offer goes and the new input replaces the old draft.
  useEffect(() => {
    if (options.dirty && pendingOffer.current) setOffer(null);
  }, [options.dirty]);

  useEffect(() => {
    if (!key) return;
    const timer = globalThis.setTimeout(() => write.current(), WRITE_DELAY_MS);
    return () => globalThis.clearTimeout(timer);
  }, [key, options.values, options.lines, options.dirty, offer]);

  useEffect(() => {
    if (!key) return;
    const onHide = () => write.current(true);
    globalThis.addEventListener('pagehide', onHide);
    return () => {
      globalThis.removeEventListener('pagehide', onHide);
      // Leaving the screen inside the app (after the unsaved-changes confirmation) keeps the input as well.
      write.current(true);
    };
  }, [key]);

  return {
    offer,
    stale,
    kept,
    restore: () => {
      if (!offer) return;
      const o = latest.current;
      const restored = applyDraft(offer, {
        entity: o.entity,
        values: o.baseValues,
        lines: o.baseLines,
        specs: o.specs,
      });
      setOffer(null);
      o.onRestore(restored.values, restored.lines);
    },
    discard: () => {
      removeDraft(draftStorage(), key);
      setOffer(null);
    },
    dismissStale: () => setStale(false),
    clear: () => {
      removeDraft(draftStorage(), key);
      cleared.current = { values: latest.current.values, lines: latest.current.lines };
      setKept(false);
    },
  };
}

/** The offer above the form, and the notice when a draft was dropped because the record changed. */
export function FormDraftNotice({ control }: { control: FormDraftControl }) {
  const { t, locale } = useLocale();
  if (control.offer)
    return (
      <div
        className="ui-notice ui-notice-info flex flex-wrap items-center gap-2 text-xs"
        data-testid="draft-offer"
        data-saved-at={control.offer.savedAt}
      >
        <p className="min-w-0 flex-1">
          {t({
            ja: `前回の未保存の入力が残っています（${formatTimestamp(control.offer.savedAt, locale)}）。復元しますか？`,
            en: `Unsaved input from your last visit is kept (${formatTimestamp(control.offer.savedAt, locale)}). Restore it?`,
          })}
        </p>
        <Button size="sm" variant="primary" onClick={control.restore}>
          {t({ ja: '復元する', en: 'Restore' })}
        </Button>
        <Button size="sm" onClick={control.discard}>
          {t({ ja: '破棄する', en: 'Discard' })}
        </Button>
      </div>
    );
  if (control.stale)
    return (
      <div className="ui-notice ui-notice-warning flex flex-wrap items-center gap-2 text-xs" data-testid="draft-stale">
        <p className="min-w-0 flex-1">
          {t({
            ja: 'この記録は前回の入力の後に更新されたため、前回の未保存の入力は復元しません。',
            en: 'This record changed after your last unsaved input, so that input is not restored.',
          })}
        </p>
        <Button size="sm" onClick={control.dismissStale}>
          {t({ ja: '閉じる', en: 'Dismiss' })}
        </Button>
      </div>
    );
  return null;
}
