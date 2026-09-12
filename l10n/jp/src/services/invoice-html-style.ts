// Inline stylesheet for the 適格請求書 layout (spec AC-4): self-contained, A4 print-friendly, no external assets.
export const INVOICE_CSS = `
@page { size: A4; margin: 15mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Meiryo", sans-serif; font-size: 10.5pt; line-height: 1.5; color: #000; background: #fff; }
.invoice { width: 180mm; margin: 0 auto; padding: 10mm 0; }
h1 { font-size: 20pt; letter-spacing: 0.5em; text-indent: 0.5em; text-align: center; margin: 0 0 8mm; }
h2 { font-size: 11pt; margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #000; }
p { margin: 0; }
.head { display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 6mm; }
.head > div { flex: 1 1 0; }
.recipient .name { font-size: 14pt; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 1mm; margin-bottom: 2mm; }
.issuer { text-align: left; }
.issuer .name { font-size: 12pt; font-weight: bold; }
.issuer .regno { font-weight: bold; }
table { border-collapse: collapse; width: 100%; }
table.meta { width: auto; min-width: 70mm; margin-bottom: 4mm; }
table.meta th, table.meta td { text-align: left; padding: 0.5mm 3mm 0.5mm 0; border: 0; }
.amount-due { display: flex; align-items: baseline; gap: 6mm; margin: 4mm 0 6mm; padding: 2mm 3mm; border: 2px solid #000; }
.amount-due .label { font-weight: bold; }
.amount-due .value { font-size: 16pt; font-weight: bold; margin-left: auto; }
table.lines th, table.lines td, table.tax-summary th, table.tax-summary td { border: 1px solid #000; padding: 1.2mm 2mm; }
table.lines th, table.tax-summary th { background: #eee; font-weight: bold; text-align: center; }
table.tax-summary { width: auto; min-width: 110mm; margin-left: auto; margin-top: 4mm; }
table.tax-summary caption { text-align: left; font-weight: bold; margin-bottom: 1mm; }
table.tax-summary tfoot th, table.tax-summary tfoot td { font-weight: bold; }
.num { text-align: right; white-space: nowrap; }
.center { text-align: center; }
.legend { font-size: 9pt; margin-top: 1mm; }
.bank p, .remarks p { white-space: pre-wrap; }
@media print { .invoice { width: auto; padding: 0; } }
`.trim();
