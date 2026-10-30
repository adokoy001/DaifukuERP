// UI kit: FormSection — a titled group of fields.
// - default: <div role="group"> labelled by its heading (a group, not a landmark, so nested sections inside a form
//   do not flood the landmark list);
// - `landmark`: a <section> labelled by its heading (a region landmark) for a top-level part of a page;
// - `as="fieldset"`: the title is the fieldset's <legend> (its first child), for grouped inputs.
// - `headingRef`: the heading becomes focusable from script (tabIndex -1), so a page can move keyboard focus to a section
//   that appears after an action (e.g. a result whose opener is now disabled).
import { useId, type ReactNode, type Ref } from 'react';
import { cx } from './cx.ts';

export interface FormSectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Inline after the title (e.g. a technical key). */
  meta?: ReactNode;
  /** Right side of the heading row (e.g. "Edit as JSON"). */
  actions?: ReactNode;
  as?: 'group' | 'fieldset';
  /** Render a named region landmark (<section>) instead of a group; ignored for fieldsets. */
  landmark?: boolean;
  headingLevel?: 2 | 3;
  /** Focus target for script (the heading gets tabIndex -1); ignored for fieldsets, whose title is a legend. */
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
  className?: string;
}

export function FormSection({
  title,
  description,
  meta,
  actions,
  as = 'group',
  landmark = false,
  headingLevel = 2,
  headingRef,
  children,
  className,
}: FormSectionProps) {
  const id = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const actionsNode = actions ? <div className="ui-section-actions">{actions}</div> : null;
  const descriptionNode = description ? <p className="ui-section-description">{description}</p> : null;
  if (as === 'fieldset')
    return (
      <fieldset className={cx('ui-form-section', className)}>
        <legend className="ui-section-title">{title}</legend>
        {meta || actionsNode ? (
          <div className="ui-section-head">
            {meta}
            {actionsNode}
          </div>
        ) : null}
        {descriptionNode}
        {children}
      </fieldset>
    );
  const content = (
    <>
      <div className="ui-section-head">
        <Heading id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="ui-section-title">
          {title}
        </Heading>
        {meta}
        {actionsNode}
      </div>
      {descriptionNode}
      {children}
    </>
  );
  return landmark ? (
    <section className={cx('ui-form-section', className)} aria-labelledby={id}>
      {content}
    </section>
  ) : (
    <div role="group" className={cx('ui-form-section', className)} aria-labelledby={id}>
      {content}
    </div>
  );
}
