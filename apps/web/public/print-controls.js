// External, same-origin controls for blob print documents under the enforced CSP. No inline handlers are required.
for (const button of globalThis.document.querySelectorAll('.daifuku-print-bar button[data-daifuku-print]')) {
  const action = button.getAttribute('data-daifuku-print');
  if (action === 'print') button.addEventListener('click', () => globalThis.print());
  if (action === 'close') button.addEventListener('click', () => globalThis.close());
}
