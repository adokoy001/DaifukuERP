// @daifuku/mod-print-layout public API (docs/specs/print-templates.md): the shared layout of printed documents as pure
// functions, the `print_layout.date_style` setting and the era override point. A library: importing it registers no
// module, entity or action (D-2). Modules build `<Document>RenderData`, then render with these parts.
export {
  escapeHtml,
  formatMoney,
  formatRate,
  sumDecimals,
  formatWesternDate,
  formatDocumentDate,
  DATE_STYLES,
  type DateStyle,
  type EraDateFn,
} from './format.ts';
export {
  REDUCED_MARK,
  CELL,
  th,
  td,
  postalAddress,
  issuerBlock,
  addresseeBlock,
  partiesSection,
  metaTable,
  documentHeader,
  amountBlock,
  dataTable,
  lineTable,
  taxBreakdownTable,
  totalsTable,
  remarksSection,
  reducedLegend,
  noteLine,
  statusBanner,
  type Align,
  type Addressee,
  type Column,
  type PrintLine,
  type TaxBreakdownRow,
  type BannerKind,
} from './blocks.ts';
export { printDocument, withStatusBanner, type PrintDocumentInput } from './document.ts';
export { issuerFromCompanyProfile, definedProps, type PrintIssuer } from './issuer.ts';
export {
  PRINT_DATE_STYLE_KEY,
  PRINT_DATE_STYLE_DEFAULT,
  PRINT_DATE_STYLE_SETTING,
  PRINT_ERA_DATE_OVERRIDE,
  printDateStyleSchema,
  ensurePrintLayoutSettings,
  printTools,
  loadPrintTools,
  type PrintTools,
} from './settings.ts';
