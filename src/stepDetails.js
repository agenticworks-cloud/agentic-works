'use strict';
// The Get started page's step details: the longer text shown beside the steps (src/getStartedPage.js), one markdown
// file per step in media/getstarted/, rendered here in the extension host and sent in the page's state. The gateway
// step has two: the company's gateway alone (claude-company-gateway.md), or every way Claude can run
// (claude-every-way.md); the page shows the first while a company gateway is named, as its controls do. The talk step
// has two as well: a Claude tab opening by itself on the company gateway (agents-auto.md, with the company file's
// gateway.openTabOnTalk), or the New Claude Tab and New Codex Tab buttons (agents.md).
//
// Not VS Code's markdown.api.render: it works from an extension, but its HTML isn't sanitized (raw HTML passes
// through, and other extensions' markdown-it plugins run in it), it needs the built-in Markdown extension enabled, and
// the offline tests can't run it. This renderer knows only what the texts use: headings, paragraphs, lists, bold,
// inline code and links. Every character of the text is HTML-escaped, and a link is kept only when it is https (any
// other is left as its text); the page sends a click on one to the host, which opens it (httpsUrl, again).
//
// The company file's words go in through {{gateway}} (the gateway's name) and {{title}} (its title). They come from a
// user-owned file, so each is held out of the markdown as a marker while the markup is made, then put back
// HTML-escaped: it is never read as markdown or as HTML, and a link whose address holds one is left as its text.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'media', 'getstarted');
const COMPANY_GATEWAY = 'claude-company-gateway';
const EVERY_WAY = 'claude-every-way';
const AGENTS_AUTO = 'agents-auto';
// a word the company file doesn't give: what the sentence then says instead
const DEFAULT_WORDS = { gateway: 'the gateway', title: 'your company' };
// a marker for a placeholder: private-use characters, taken out of the texts and the values first
const OPEN = '', CLOSE = '';
const MARKERS = /[]/g;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** The URL, normalised, if it is an https one; else ''. */
function httpsUrl(u) {
  if (typeof u !== 'string' || !u) return '';
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.href : '';
  } catch (_) {
    return '';
  }
}

// ---- inline: code spans, links ([text](url) and <https://...>), bold; everything else escaped
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|<(https:\/\/[^>\s]+)>|\*\*(.+?)\*\*/g;
function inline(text, inLink = false) {
  let out = '', at = 0;
  for (const m of text.matchAll(INLINE)) {
    out += escapeHtml(text.slice(at, m.index));
    at = m.index + m[0].length;
    const [, code, linkText, linkUrl, auto, bold] = m;
    if (code !== undefined) out += `<code>${escapeHtml(code)}</code>`;
    else if (bold !== undefined) out += `<strong>${inline(bold, inLink)}</strong>`;
    else {
      const label = auto !== undefined ? escapeHtml(auto) : inline(linkText, true);
      const url = auto !== undefined ? auto : linkUrl;
      const href = inLink || url.includes(OPEN) ? '' : httpsUrl(url);   // a placeholder in an address: no link
      out += href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
    }
  }
  return out + escapeHtml(text.slice(at));
}

// ---- blocks: # headings (one level below the details' own heading), - or 1. lists (a line indented under an item
// carries it on), paragraphs (lines run together until a blank line)
function render(markdown) {
  const html = [];
  let para = [], list = null;   // list: { tag, items: [lines] }
  const endPara = () => { if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const endList = () => {
    if (list) html.push(`<${list.tag}>${list.items.map((l) => `<li>${inline(l.join(' '))}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of String(markdown).split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { endPara(); endList(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      endPara(); endList();
      const h = m[1].length + 2;
      html.push(`<h${h}>${inline(m[2].trim())}</h${h}>`);
    } else if ((m = /^\s{0,3}([-*]|\d+\.)\s+(.*)$/.exec(line))) {
      endPara();
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list && list.tag !== tag) endList();
      if (!list) list = { tag, items: [] };
      list.items.push([m[2].trim()]);
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1].push(line.trim());
    } else {
      endList();
      para.push(line.trim());
    }
  }
  endPara(); endList();
  return html.join('\n');
}

/** The markdown rendered, with {{gateway}} and {{title}} put in from `words`, escaped. Other {{…}} stay as text. */
function renderDetails(markdown, words = {}) {
  const values = [];
  const held = String(markdown).replace(MARKERS, '').replace(/\{\{(gateway|title)\}\}/g, (_, k) => {
    const given = typeof words[k] === 'string' ? words[k].replace(MARKERS, '').replace(/\s+/g, ' ').trim() : '';
    values.push(given || DEFAULT_WORDS[k]);
    return `${OPEN}${values.length - 1}${CLOSE}`;
  });
  return render(held).replace(/(\d+)/g, (_, i) => escapeHtml(values[Number(i)]));
}

/**
 * The details file of a step: the gateway step's depends on whether a company gateway is named, the talk step's on
 * whether its tab opens by itself (autoTab).
 */
function detailsFile(id, { companyGateway = false, autoTab = false } = {}) {
  if (id === 'claude') return companyGateway ? COMPANY_GATEWAY : EVERY_WAY;
  if (id === 'agents' && autoTab) return AGENTS_AUTO;
  return id;
}

const texts = new Map();   // file → its markdown ('' when missing): the files ship with Agentic Works and don't change
function readText(file) {
  if (!texts.has(file)) {
    let text = '';
    try { text = fs.readFileSync(path.join(DIR, `${file}.md`), 'utf8'); } catch (_) { /* no details: the page shows none */ }
    texts.set(file, text);
  }
  return texts.get(file);
}

/**
 * A step's details as HTML ('' when it has no file). `words`: { gateway, title } from the company file; `note`: the
 * company file's own text for this step, put first and rendered by the same rules (escaped, https links only).
 */
function stepDetails(id, { companyGateway = false, autoTab = false, words = {}, note = '' } = {}) {
  const text = /^[a-z-]+$/.test(id) ? readText(detailsFile(id, { companyGateway, autoTab })) : '';
  if (!text) return '';
  const own = typeof note === 'string' && note.trim() ? renderDetails(note, words) + '\n' : '';
  return own + renderDetails(text, words);
}

module.exports = { stepDetails, renderDetails, detailsFile, httpsUrl, escapeHtml, DETAILS_DIR: DIR };
