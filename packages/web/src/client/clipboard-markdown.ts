export interface ClipboardContent {
  html?: string;
  text: string;
}

interface HtmlList {
  kind: 'ordered' | 'unordered';
  next: number;
}

interface InlineTag {
  closing: string;
  name: string;
}

const blockTags = new Set([
  'address',
  'article',
  'aside',
  'div',
  'footer',
  'header',
  'main',
  'nav',
  'p',
  'section',
]);

const ignoredTags = new Set(['head', 'script', 'style', 'template']);

function decodedCodePoint(value: number, fallback: string): string {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0x10ffff ||
    (value >= 0xd800 && value <= 0xdfff)
  ) {
    return fallback;
  }
  return String.fromCodePoint(value);
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    hellip: '…',
    lt: '<',
    mdash: '—',
    nbsp: '\u00a0',
    ndash: '–',
    quot: '"',
  };
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/giu, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const point = Number.parseInt(code.slice(2), 16);
      return decodedCodePoint(point, entity);
    }
    if (code.startsWith('#')) {
      const point = Number.parseInt(code.slice(1), 10);
      return decodedCodePoint(point, entity);
    }
    return named[code.toLocaleLowerCase()] ?? entity;
  });
}

function attribute(tag: string, name: string): string {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu')
  );
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function safeLink(value: string): string {
  const href = value.trim();
  if (
    !href ||
    href.split('').some((character) => character.charCodeAt(0) < 32) ||
    /^\/\//u.test(href) ||
    (/^[a-z][a-z\d+.-]*:/iu.test(href) && !/^(?:https?:|mailto:|tel:)/iu.test(href))
  ) {
    return '';
  }
  return href.replaceAll(' ', '%20').replaceAll(')', '\\)');
}

function tidyMarkdown(value: string): string {
  return value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Converts the safe, commonly copied subset of HTML into portable Markdown.
 * Clipboard HTML is interpreted as text only and is never injected into the page.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: HTML clipboard conversion is an ordered streaming transform.
export function richTextHtmlToMarkdown(html: string): string {
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/gu) ?? [];
  const lists: HtmlList[] = [];
  const inlineTags: InlineTag[] = [];
  let output = '';
  let ignoredDepth = 0;
  let inPre = false;
  let quoteDepth = 0;

  const ensureNewlines = (count: number) => {
    if (!output) return;
    const current = output.match(/\n*$/u)?.[0].length ?? 0;
    if (current < count) output += '\n'.repeat(count - current);
  };
  const appendText = (raw: string) => {
    if (!raw || ignoredDepth) return;
    let value = decodeHtml(raw);
    if (!inPre) {
      value = value.replace(/[\t\n\r ]+/gu, ' ');
      if (!output || /[\s\n]$/u.test(output)) value = value.replace(/^ /u, '');
    }
    if (quoteDepth && output.endsWith('\n')) output += `${'> '.repeat(quoteDepth)}`;
    output += value;
  };
  const closeInline = (name: string) => {
    let index = inlineTags.length - 1;
    while (index >= 0 && inlineTags[index]?.name !== name) index -= 1;
    if (index < 0) return;
    const [tag] = inlineTags.splice(index, 1);
    output += tag?.closing ?? '';
  };

  for (const token of tokens) {
    if (!token.startsWith('<')) {
      appendText(token);
      continue;
    }
    if (/^<!--|^<![^-]/u.test(token)) continue;

    const closing = /^<\s*\//u.test(token);
    const name = token.match(/^<\s*\/?\s*([a-z\d-]+)/iu)?.[1]?.toLocaleLowerCase() ?? '';
    if (!name) continue;

    if (ignoredTags.has(name)) {
      if (closing) ignoredDepth = Math.max(0, ignoredDepth - 1);
      else ignoredDepth += 1;
      continue;
    }
    if (ignoredDepth) continue;

    if (closing) {
      if (name === 'strong' || name === 'b') closeInline(name);
      else if (name === 'em' || name === 'i') closeInline(name);
      else if (name === 'del' || name === 's' || name === 'strike') closeInline(name);
      else if (name === 'code' && !inPre) closeInline(name);
      else if (name === 'a') closeInline(name);
      else if (/^h[1-6]$/u.test(name) || blockTags.has(name)) ensureNewlines(2);
      else if (name === 'li') ensureNewlines(1);
      else if (name === 'ul' || name === 'ol') {
        lists.pop();
        ensureNewlines(lists.length ? 1 : 2);
      } else if (name === 'blockquote') {
        quoteDepth = Math.max(0, quoteDepth - 1);
        ensureNewlines(2);
      } else if (name === 'pre') {
        if (!output.endsWith('\n')) output += '\n';
        output += '```';
        inPre = false;
        ensureNewlines(2);
      }
      continue;
    }

    if (name === 'br') {
      output += quoteDepth ? `\n${'> '.repeat(quoteDepth)}` : '\n';
      continue;
    }
    if (name === 'hr') {
      ensureNewlines(2);
      output += '---';
      ensureNewlines(2);
      continue;
    }
    if (/^h[1-6]$/u.test(name)) {
      ensureNewlines(2);
      output += `${'#'.repeat(Number(name[1]))} `;
      continue;
    }
    if (blockTags.has(name)) {
      ensureNewlines(2);
      continue;
    }
    if (name === 'ul' || name === 'ol') {
      ensureNewlines(1);
      const start = Number.parseInt(attribute(token, 'start'), 10);
      lists.push({
        kind: name === 'ol' ? 'ordered' : 'unordered',
        next: Number.isFinite(start) ? start : 1,
      });
      continue;
    }
    if (name === 'li') {
      ensureNewlines(1);
      const list = lists.at(-1) ?? { kind: 'unordered' as const, next: 1 };
      const marker = list.kind === 'ordered' ? `${list.next}.` : '-';
      if (list.kind === 'ordered') list.next += 1;
      output += `${'  '.repeat(Math.max(0, lists.length - 1))}${marker} `;
      continue;
    }
    if (name === 'blockquote') {
      ensureNewlines(2);
      quoteDepth += 1;
      output += '> '.repeat(quoteDepth);
      continue;
    }
    if (name === 'pre') {
      ensureNewlines(2);
      output += '```\n';
      inPre = true;
      continue;
    }
    if (name === 'strong' || name === 'b') {
      output += '**';
      inlineTags.push({ closing: '**', name });
      continue;
    }
    if (name === 'em' || name === 'i') {
      output += '_';
      inlineTags.push({ closing: '_', name });
      continue;
    }
    if (name === 'del' || name === 's' || name === 'strike') {
      output += '~~';
      inlineTags.push({ closing: '~~', name });
      continue;
    }
    if (name === 'code' && !inPre) {
      output += '`';
      inlineTags.push({ closing: '`', name });
      continue;
    }
    if (name === 'a') {
      const href = safeLink(attribute(token, 'href'));
      if (href) {
        output += '[';
        inlineTags.push({ closing: `](${href})`, name });
      } else {
        inlineTags.push({ closing: '', name });
      }
      continue;
    }
    if (name === 'img') {
      const source = safeLink(attribute(token, 'src'));
      if (source) output += `![${attribute(token, 'alt').replaceAll(']', '\\]')}](${source})`;
    }
  }

  while (inlineTags.length) output += inlineTags.pop()?.closing ?? '';
  return tidyMarkdown(output);
}

/** Prefers formatted clipboard HTML, falling back to exact plain text. */
export function markdownFromClipboard({ html = '', text }: ClipboardContent): string {
  const rich = html ? richTextHtmlToMarkdown(html) : '';
  return rich || text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/**
 * Makes ordered Markdown list items parseable by the bullet outliner while
 * retaining their visible numeric marker in block content.
 */
export function normalizePastedMarkdown(markdown: string): string {
  return markdown
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => {
      const ordered = line.match(/^([ \t]*)(\d+[.)])\s+(.*)$/u);
      return ordered ? `${ordered[1] ?? ''}- ${ordered[2] ?? '1.'} ${ordered[3] ?? ''}` : line;
    })
    .join('\n')
    .trim();
}
