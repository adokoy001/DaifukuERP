// UI kit: small typed, accessible building blocks for screens (docs/conventions/ui.md "UI kit and tokens").
// Components take already-translated strings; they never call useLocale() themselves.
export { Badge, type BadgeProps, type BadgeTone } from './badge.tsx';
export { Button, buttonClass, type ButtonProps, type ButtonSize, type ButtonVariant } from './button.tsx';
export { Card, type CardProps } from './card.tsx';
export { cx } from './cx.ts';
export {
  ariaSortFor,
  cellAlignClass,
  DataTableShell,
  type CellAlign,
  type DataTableShellProps,
} from './data-table-shell.tsx';
export { Dialog, type DialogProps } from './dialog.tsx';
export { EmptyState, type EmptyStateProps } from './empty-state.tsx';
export { FormSection, type FormSectionProps } from './form-section.tsx';
export { PageHeader, type PageHeaderProps } from './page-header.tsx';
export { Skeleton, SkeletonCard, SkeletonRows, type SkeletonProps } from './skeleton.tsx';
export {
  nextTabIndex,
  scrollToShow,
  TabPanel,
  tabPanelId,
  tabId,
  Tabs,
  type TabItem,
  type TabPanelProps,
  type TabsProps,
} from './tabs.tsx';
export { Toolbar, type ToolbarProps } from './toolbar.tsx';
