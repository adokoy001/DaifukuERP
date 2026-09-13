// Builds the user manual (docs/manual/*.md, PLAN v0.4 Phase 2M) into ONE self-contained HTML file:
// docs/manual/daifuku-manual.html — embedded CSS, sticky table of contents, every image inlined as a data URI.
// Markdown is rendered by python3's `markdown` package (tables, fenced_code, toc) through child_process, so no npm
// package is added. Usage: `pnpm manual:build`.
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = join(ROOT, 'docs', 'manual');
const OUT = join(MANUAL_DIR, 'daifuku-manual.html');
const TITLE = 'DaifukuERP 操作マニュアル';
const IMAGE_WARN_BYTES = 200 * 1024;
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

/** Chapter files in reading order: 00-…, 01-…, …, then appendix-a-…, appendix-b-…. */
function chapterFiles() {
  const names = readdirSync(MANUAL_DIR).filter(
    (n) => /^(\d\d-|appendix-[a-z]-).+\.md$/.test(n) || n === 'edge-service-setup.md',
  );
  const rank = (n) =>
    n === 'edge-service-setup.md' ? '1appendix-k-edge-service-setup.md' : n.startsWith('appendix-') ? `1${n}` : `0${n}`;
  return names.sort((a, b) => rank(a).localeCompare(rank(b)));
}

/** `05-daily.md` -> `05`, `appendix-a-glossary.md` -> `appendix-a`. Used for section ids and id prefixes. */
function chapterKey(file) {
  if (file === 'edge-service-setup.md') return 'appendix-k';
  const m = /^(\d\d|appendix-[a-z])-/.exec(file);
  if (!m) throw new Error(`unexpected chapter file name: ${file}`);
  return m[1];
}

/** Short label for the sticky table of contents: the chapter's H1 without the parenthesised part. */
function titleOf(markdown, key) {
  const h1 = /^#\s+(.+)$/m.exec(markdown);
  if (key === '00') return '00 はじめに';
  return h1 ? h1[1].replace(/（[^）]*）/g, '').trim() : key;
}

const PY = `
import json, sys
import markdown
from markdown.extensions.toc import slugify_unicode
texts = json.load(sys.stdin)
out = [markdown.markdown(t, extensions=['tables', 'fenced_code', 'toc', 'sane_lists'],
                         extension_configs={'toc': {'slugify': slugify_unicode, 'permalink': False}}) for t in texts]
json.dump(out, sys.stdout, ensure_ascii=False)
`;

function renderMarkdown(texts) {
  try {
    const stdout = execFileSync('python3', ['-c', PY], {
      input: JSON.stringify(texts),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `python3 markdown rendering failed (needs python3 with the "markdown" package: pip install markdown): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inlines `img/<file>` as a data URI and turns a paragraph holding only an image into a captioned figure. */
function inlineImages(html, file, stats) {
  const toDataUri = (src) => {
    const path = join(MANUAL_DIR, src);
    if (!existsSync(path)) throw new Error(`${file}: image not found: ${src}`);
    const mime = MIME[extname(path).toLowerCase()];
    if (!mime) throw new Error(`${file}: unsupported image type: ${src}`);
    const size = statSync(path).size;
    if (size > IMAGE_WARN_BYTES) stats.warnings.push(`${src} is ${Math.round(size / 1024)} KB (> 200 KB)`);
    stats.images += 1;
    stats.imageBytes += size;
    return `data:${mime};base64,${Buffer.from(readFileSync(path)).toString('base64')}`;
  };
  const figure = html.replace(
    /<p>\s*<img alt="([^"]*)" src="(img\/[^"]+)"\s*\/?>\s*<\/p>/g,
    (_m, alt, src) =>
      `<figure><img alt="${alt}" src="${toDataUri(src)}" loading="lazy"><figcaption>${alt}</figcaption></figure>`,
  );
  return figure.replace(
    /<img alt="([^"]*)" src="(img\/[^"]+)"\s*\/?>/g,
    (_m, alt, src) => `<img alt="${alt}" src="${toDataUri(src)}" loading="lazy">`,
  );
}

/** Heading ids are unique per chapter only, so prefix them; links to other chapter files become in-page anchors. */
function rewriteIdsAndLinks(html, key) {
  const prefix = `c${key}-`;
  let out = html.replace(/ id="([^"]+)"/g, (_m, id) => ` id="${prefix}${id}"`);
  out = out.replace(/href="#([^"]+)"/g, (_m, anchor) => `href="#${prefix}${anchor}"`);
  out = out.replace(/href="((\d\d|appendix-[a-z])-[a-z0-9-]+)\.md(#[^"]*)?"/g, (_m, _file, otherKey, anchor) =>
    anchor ? `href="#c${otherKey}-${anchor.slice(1)}"` : `href="#ch-${otherKey}"`,
  );
  // Tables can be wider than the page on phones: give each its own scroll box.
  return out.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
}

const CSS = `
:root { --fg: #1f2328; --muted: #57606a; --line: #d0d7de; --bg: #ffffff; --soft: #f6f8fa; --accent: #0a5d8f; --warn-bg: #fff8e5; }
* { box-sizing: border-box; }
html { scroll-padding-top: 5.5rem; scroll-behavior: auto; }
body { margin: 0; color: var(--fg); background: var(--bg); font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", system-ui, sans-serif; font-size: 16px; line-height: 1.85; letter-spacing: 0.01em; font-feature-settings: "palt" 0; }
.toc { position: sticky; top: 0; z-index: 10; background: rgba(255,255,255,0.97); border-bottom: 1px solid var(--line); padding-inline: 16px; }
.toc-inner { max-width: 900px; margin: 0 auto; padding-block: 0.4rem; }
.toc-title { font-weight: 700; font-size: 0.85rem; margin: 0 0 0.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toc ol { list-style: none; margin: 0; padding: 0 0 0.25rem; display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 0.35rem; font-size: 0.8rem; line-height: 1.5; scrollbar-width: thin; }
.toc a { display: inline-block; padding: 0.1rem 0.45rem; border: 1px solid var(--line); border-radius: 999px; color: var(--fg); text-decoration: none; white-space: nowrap; }
.toc a:hover { border-color: var(--accent); color: var(--accent); }
main { max-width: 900px; margin: 0 auto; padding-inline: 16px; padding-block: 1rem 4rem; }
section.chapter { padding-top: 1.5rem; border-top: 3px solid var(--fg); margin-top: 3rem; }
section.chapter:first-child { border-top: none; margin-top: 0; }
h1 { font-size: 1.75rem; line-height: 1.4; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.3rem; line-height: 1.5; margin: 2.2rem 0 0.6rem; padding-bottom: 0.2rem; border-bottom: 1px solid var(--line); }
h3 { font-size: 1.08rem; margin: 1.6rem 0 0.4rem; }
p, ul, ol { margin: 0.6rem 0; }
li { margin: 0.2rem 0; }
a { color: var(--accent); }
code { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 0.86em; background: var(--soft); border: 1px solid #eaeef2; border-radius: 4px; padding: 0.05em 0.3em; overflow-wrap: anywhere; }
pre { background: #0d1117; color: #e6edf3; border-radius: 6px; padding: 0.8rem 1rem; overflow-x: auto; line-height: 1.55; }
pre code { background: none; border: none; padding: 0; color: inherit; font-size: 0.84rem; overflow-wrap: normal; }
.table-wrap { overflow-x: auto; margin: 0.8rem 0; }
table { border-collapse: collapse; font-size: 0.9rem; line-height: 1.6; min-width: 60%; }
th, td { border: 1px solid var(--line); padding: 0.35rem 0.6rem; vertical-align: top; text-align: left; }
th { background: var(--soft); white-space: nowrap; }
figure { margin: 1rem 0 1.4rem; }
figure img, img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
figcaption { font-size: 0.85rem; color: var(--muted); margin-top: 0.3rem; }
hr { border: none; border-top: 1px dashed var(--line); margin: 2rem 0 0.8rem; }
hr + p { font-size: 0.85rem; color: var(--muted); background: var(--warn-bg); border-radius: 4px; padding: 0.5rem 0.75rem; }
strong { font-weight: 700; }
.colophon { color: var(--muted); font-size: 0.8rem; margin-top: 3rem; }
@media print { .toc { display: none; } section.chapter { break-before: page; border-top: none; } figure { break-inside: avoid; } pre { white-space: pre-wrap; } }
`;

function build() {
  const files = chapterFiles();
  if (files.length === 0) throw new Error(`no chapters in ${MANUAL_DIR}`);
  const sources = files.map((f) => readFileSync(join(MANUAL_DIR, f), 'utf8'));
  const rendered = renderMarkdown(sources);
  const stats = { images: 0, imageBytes: 0, warnings: [] };
  const toc = [];
  const sections = files.map((file, i) => {
    const key = chapterKey(file);
    toc.push(`<li><a href="#ch-${key}">${escapeHtml(titleOf(sources[i], key))}</a></li>`);
    const body = rewriteIdsAndLinks(inlineImages(rendered[i], file, stats), key);
    return `<section class="chapter" id="ch-${key}" data-source="docs/manual/${file}">\n${body}\n</section>`;
  });
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(TITLE)}</title>
<style>${CSS}</style>
</head>
<body>
<nav class="toc" aria-label="目次"><div class="toc-inner"><p class="toc-title">${escapeHtml(TITLE)}</p><ol>${toc.join('')}</ol></div></nav>
<main>
${sections.join('\n')}
<p class="colophon">このファイルは <code>pnpm manual:build</code>（scripts/build-manual.mjs）で docs/manual/*.md から生成しました。直接編集せず、Markdown を直してから再生成してください。</p>
</main>
</body>
</html>
`;
  writeFileSync(OUT, html);
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`wrote ${OUT}`);
  console.log(
    `chapters: ${files.length}, images: ${stats.images} (${kb(stats.imageBytes)} source), html: ${kb(Buffer.byteLength(html))}`,
  );
  for (const w of stats.warnings) console.warn(`warning: ${w}`);
}

build();
