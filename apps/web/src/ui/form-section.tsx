// UI kit: FormSection — a titled group of fields. `as="fieldset"` puts the title in a <legend> (grouped inputs);
// the default <section> uses a heading and is labelled by it.
import { useId, type ReactNode } from 'react';
import { cx } from './cx.ts';

export interface FormSectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Inline after the title (e.g. a technical key). */
  meta?: ReactNode;
  /** Right side of the heading row (e.g. "Edit as JSON"). */
  actions?: ReactNode;
  as?: 'section' | 'fieldset';
  headingLevel?: 2 | 3;
  children?: ReactNode;
  className?: string;
}

export function FormSection({
  title,
  description,
  meta,
  actions,
  as = 'section',
  headingLevel = 2,
  children,
  className,
}: FormSectionProps) {
  const id = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const titleNode =
    as === 'fieldset' ? (
      <legend id={id} className="ui-section-title">
        {title}
      </legend>
    ) : (
      <Heading id={id} className="ui-section-title">
        {title}
      </Heading>
    );
  const content = (
    <>
      <div className="ui-section-head">
        {titleNode}
        {meta}
        {actions ? <div className="ui-section-actions">{actions}</div> : null}
      </div>
      {description ? <p className="ui-section-description">{description}</p> : null}
      {children}
    </>
  );
  return as === 'fieldset' ? (
    <fieldset className={cx('ui-form-section', className)} aria-labelledby={id}>
      {content}
    </fieldset>
  ) : (
    <section className={cx('ui-form-section', className)} aria-labelledby={id}>
      {content}
    </section>
  );
}
