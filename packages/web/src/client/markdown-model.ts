export type MarkdownAlignment = 'left' | 'center' | 'right' | null;

export interface MarkdownTable {
  alignments: MarkdownAlignment[];
  headers: string[];
  rows: string[][];
}

export type MarkdownNode =
  | { type: 'blank'; key: string }
  | { type: 'blockquote'; lines: string[] }
  | { language: string; type: 'code'; value: string }
  | { level: number; text: string; type: 'heading' }
  | { type: 'hr' }
  | { indentation: number; state?: string; text: string; type: 'bullet' }
  | { indentation: number; marker: string; text: string; type: 'ordered' }
  | { text: string; type: 'paragraph' }
  | { table: MarkdownTable; type: 'table' };

function indentationWidth(value: string): number {
  return value.replaceAll('\t', '  ').length;
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function tableAlignments(separator: string): MarkdownAlignment[] | null {
  const cells = splitTableRow(separator);
  if (cells.length === 0 || cells.some((cell) => !/^:?-{3,}:?$/u.test(cell))) {
    return null;
  }
  return cells.map((cell) => {
    const starts = cell.startsWith(':');
    const ends = cell.endsWith(':');
    if (starts && ends) return 'center';
    if (ends) return 'right';
    return starts ? 'left' : null;
  });
}

function tableFromLines(lines: string[], index: number): MarkdownTable | null {
  const header = lines[index];
  const separator = lines[index + 1];
  if (!header || !separator || !header.includes('|')) return null;

  const alignments = tableAlignments(separator);
  if (!alignments) return null;

  const headers = splitTableRow(header);
  if (headers.length !== alignments.length) return null;

  const rows: string[][] = [];
  let cursor = index + 2;
  while (cursor < lines.length && lines[cursor]?.includes('|')) {
    const row = splitTableRow(lines[cursor] ?? '');
    if (row.length !== headers.length) break;
    rows.push(row);
    cursor += 1;
  }

  return { alignments, headers, rows };
}

function isHorizontalRule(line: string): boolean {
  return /^ {0,3}(?:\*\s*){3,}$|^ {0,3}(?:-\s*){3,}$|^ {0,3}(?:_\s*){3,}$/u.test(line);
}

function isFence(line: string): RegExpMatchArray | null {
  return line.match(/^ {0,3}```\s*([^`]*)$/u);
}

/** Parses the block-level Markdown supported by the page reader. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Block parsing is intentionally ordered so Markdown constructs win over paragraph fallback.
export function parseMarkdownDocument(markdown: string): MarkdownNode[] {
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const nodes: MarkdownNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      nodes.push({ key: `blank-${nodes.length}`, type: 'blank' });
      continue;
    }

    const fence = isFence(line);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !isFence(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      nodes.push({ language: fence[1]?.trim() ?? '', type: 'code', value: codeLines.join('\n') });
      continue;
    }

    const table = tableFromLines(lines, index);
    if (table) {
      nodes.push({ table, type: 'table' });
      index += table.rows.length + 1;
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})(?:\s+|$)(.*)$/u);
    if (heading) {
      nodes.push({
        level: heading[1]?.length ?? 1,
        text: heading[2]?.trim() ?? '',
        type: 'heading',
      });
      continue;
    }

    if (isHorizontalRule(line)) {
      nodes.push({ type: 'hr' });
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index] ?? '')) {
        quoteLines.push((lines[index] ?? '').replace(/^ {0,3}>\s?/u, ''));
        index += 1;
      }
      index -= 1;
      nodes.push({ lines: quoteLines, type: 'blockquote' });
      continue;
    }

    const bullet = line.match(/^([ \t]*)[-*+]\s+(?:(TODO|DONE|LATER)\s+)?(.*)$/u);
    if (bullet) {
      nodes.push({
        indentation: indentationWidth(bullet[1] ?? ''),
        state: bullet[2]?.toLocaleLowerCase(),
        text: bullet[3] ?? '',
        type: 'bullet',
      });
      continue;
    }

    const ordered = line.match(/^([ \t]*)(\d+[.)])\s+(.*)$/u);
    if (ordered) {
      nodes.push({
        indentation: indentationWidth(ordered[1] ?? ''),
        marker: ordered[2] ?? '1.',
        text: ordered[3] ?? '',
        type: 'ordered',
      });
      continue;
    }

    const paragraphLines = [line.trim()];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? '';
      if (
        !next.trim() ||
        isFence(next) ||
        tableFromLines(lines, index + 1) ||
        /^ {0,3}(?:#{1,6})(?:\s+|$)/u.test(next) ||
        isHorizontalRule(next) ||
        /^ {0,3}>/.test(next) ||
        /^([ \t]*)[-*+]\s+/u.test(next) ||
        /^([ \t]*)\d+[.)]\s+/u.test(next)
      ) {
        break;
      }
      paragraphLines.push(next.trim());
      index += 1;
    }
    nodes.push({ text: paragraphLines.join('\n'), type: 'paragraph' });
  }

  return nodes;
}
