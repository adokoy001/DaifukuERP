// form-ergonomics AC-2: the header of the generic form as sections. Labelled `views.form` groups are fieldsets with a
// legend (kit FormSection); plain groups keep the original untitled boxes; registered ext fields stay under 「追加項目」.
// On a narrow screen (< 768px) a form with 4 or more labelled sections shows them as kit Tabs, each tab marked with
// the number of errors in it. Section and tab rules are pure in lib/form.ts (formSections, sectionLayout).
import { useSyncExternalStore, type ReactNode } from 'react';
import type { FieldMeta, Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { Badge, FormSection, TabPanel, Tabs } from '../ui/index.ts';

export interface HeaderSection {
  /** `g<n>` / `rest` / `auto` from formSections, or `ext` for the registered ext fields. */
  key: string;
  label?: Label | undefined;
  fields: FieldMeta[];
}

const NARROW = '(max-width: 767px)';

function subscribeNarrow(listener: () => void): () => void {
  const media = globalThis.matchMedia?.(NARROW);
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}

/** True below the 768px breakpoint (docs/conventions/ui.md), following resizes and rotation. */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => globalThis.matchMedia?.(NARROW).matches ?? false,
    () => false,
  );
}

/** The heading of a section; untitled groups get "その他" (numbered when there are several) in the tab list. */
export function sectionTitle(section: HeaderSection, untitledIndex: number, untitledCount: number): Label {
  if (section.label) return section.label;
  const n = untitledCount > 1 ? ` ${untitledIndex + 1}` : '';
  return { ja: `その他${n}`, en: `More${n}` };
}

const BOX = 'rounded border border-border bg-surface p-3';
const GRID = 'grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-3';

export interface HeaderSectionsProps {
  sections: readonly HeaderSection[];
  layout: 'stack' | 'tabs';
  selected: string;
  onSelect: (key: string) => void;
  /** Errors per section key (the tab marks). */
  errorCounts: Readonly<Record<string, number>>;
  renderField: (field: FieldMeta, section: HeaderSection) => ReactNode;
  idPrefix: string;
}

export function HeaderSections({
  sections,
  layout,
  selected,
  onSelect,
  errorCounts,
  renderField,
  idPrefix,
}: HeaderSectionsProps) {
  const { t, locale } = useLocale();
  const untitled = sections.filter((s) => !s.label);
  const title = (s: HeaderSection) => t(sectionTitle(s, untitled.indexOf(s), untitled.length));
  const fields = (s: HeaderSection) => s.fields.map((f) => renderField(f, s));
  if (layout === 'tabs') {
    const current = sections.some((s) => s.key === selected) ? selected : (sections[0]?.key ?? '');
    return (
      <div className="record-tabs flex flex-col gap-2" data-testid="form-tabs">
        <Tabs
          items={sections.map((s) => {
            const count = errorCounts[s.key] ?? 0;
            return {
              id: s.key,
              label: (
                <>
                  {title(s)}
                  {count > 0 ? (
                    <>
                      <Badge tone="danger" className="ml-1" aria-hidden="true">
                        {count}
                      </Badge>
                      <span className="sr-only">
                        {locale === 'ja' ? `（エラー ${count} 件）` : ` (${count} error${count === 1 ? '' : 's'})`}
                      </span>
                    </>
                  ) : null}
                </>
              ),
            };
          })}
          selected={current}
          onSelect={onSelect}
          label={t({ ja: '入力項目の区分', en: 'Form sections' })}
          idPrefix={idPrefix}
        />
        {sections.map((s) => (
          <TabPanel key={s.key} idPrefix={idPrefix} id={s.key} selected={s.key === current} className={BOX}>
            <div className={GRID} data-section={s.key} {...(s.key === 'ext' ? { 'data-testid': 'ext-fields' } : {})}>
              {fields(s)}
            </div>
          </TabPanel>
        ))}
      </div>
    );
  }
  return (
    <>
      {sections.map((s) => {
        if (s.key === 'ext')
          return (
            <fieldset
              key={s.key}
              className={`${BOX} ${GRID}`}
              data-testid="ext-fields"
              data-section={s.key}
              aria-label={title(s)}
            >
              <legend className="px-1 text-xs font-semibold text-text-secondary">{title(s)}</legend>
              {fields(s)}
            </fieldset>
          );
        if (!s.label)
          return (
            <fieldset key={s.key} className={`${BOX} ${GRID}`} data-section={s.key}>
              {fields(s)}
            </fieldset>
          );
        return (
          <FormSection key={s.key} as="fieldset" title={title(s)} className={`record-section ${BOX}`}>
            <div className={GRID}>{fields(s)}</div>
          </FormSection>
        );
      })}
    </>
  );
}
