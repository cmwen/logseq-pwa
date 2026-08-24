import { parseDocument, stringify } from 'yaml';

/** A YAML value supported by the frontmatter API and IndexedDB projection. */
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

/** The mapping stored between a Markdown document's frontmatter delimiters. */
export type FrontmatterData = Record<string, FrontmatterValue>;

/** The result of locating (but not parsing) a Markdown frontmatter section. */
export interface SplitFrontmatterResult {
  /** True when the document starts with a frontmatter delimiter pair. */
  hasFrontmatter: boolean;
  /** Exact source from the opening delimiter through the closing delimiter newline. */
  source: string | null;
  /** Markdown body after the frontmatter, preserving its exact source. */
  body: string;
  /** Number of source lines occupied by the frontmatter section. */
  lineCount: number;
}

/** A parsed Markdown document with frontmatter and body kept as separate concerns. */
export interface MarkdownDocument extends SplitFrontmatterResult {
  /** Parsed YAML metadata. Empty when the document has no frontmatter. */
  data: FrontmatterData;
}

/** Thrown when a frontmatter section is delimited correctly but contains invalid YAML. */
export class FrontmatterParseError extends Error {
  /** One-based line within the frontmatter payload where parsing failed, when known. */
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(line === undefined ? message : `Frontmatter line ${line}: ${message}`);
    this.name = 'FrontmatterParseError';
    this.line = line;
  }
}

const normalizedLineEnding = (value: string): string =>
  value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

function lineEndAt(source: string, start: number): number {
  const lineFeed = source.indexOf('\n', start);
  const carriageReturn = source.indexOf('\r', start);
  const newline =
    lineFeed === -1
      ? carriageReturn
      : carriageReturn === -1
        ? lineFeed
        : Math.min(lineFeed, carriageReturn);
  if (newline === -1) return source.length;
  return source[newline] === '\r' && source[newline + 1] === '\n' ? newline + 2 : newline + 1;
}

function lineValue(source: string, start: number, end: number): string {
  return source
    .slice(start, end)
    .replace(/\r?\n$/u, '')
    .replace(/\r$/u, '');
}

/**
 * Splits a Markdown document at a leading YAML frontmatter section.
 *
 * Only a delimiter on the first line is treated as frontmatter. The returned `source` includes
 * the delimiters and the newline after the closing delimiter, allowing `source + body` to recreate
 * the original document byte-for-byte. YAML parsing is intentionally separate in `parseFrontmatter`.
 */
export function splitFrontmatter(markdown: string): SplitFrontmatterResult {
  const openingStart = markdown.charCodeAt(0) === 0xfeff ? 1 : 0;
  const firstEnd = lineEndAt(markdown, openingStart);
  const firstLine = lineValue(markdown, openingStart, firstEnd);
  if (!/^---[ \t]*$/u.test(firstLine) || firstEnd === markdown.length) {
    return { hasFrontmatter: false, source: null, body: markdown, lineCount: 0 };
  }

  let cursor = firstEnd;
  let lineCount = 1;
  while (cursor < markdown.length) {
    const end = lineEndAt(markdown, cursor);
    const line = lineValue(markdown, cursor, end);
    lineCount += 1;
    if (/^(?:---|\.\.\.)[ \t]*$/u.test(line)) {
      return {
        hasFrontmatter: true,
        source: markdown.slice(0, end),
        body: markdown.slice(end),
        lineCount,
      };
    }
    cursor = end;
  }

  return { hasFrontmatter: false, source: null, body: markdown, lineCount: 0 };
}

function isFrontmatterValue(
  value: unknown,
  ancestors = new WeakSet<object>()
): value is FrontmatterValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((nested) => isFrontmatterValue(nested, ancestors))
    : Object.entries(value).every(
        ([key, nested]) => typeof key === 'string' && isFrontmatterValue(nested, ancestors)
      );
  ancestors.delete(value);
  return valid;
}

function isFrontmatterData(value: unknown): value is FrontmatterData {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isFrontmatterValue(value)
  );
}

function parseYaml(payload: string): FrontmatterData {
  const document = parseDocument(payload, {
    prettyErrors: false,
    schema: 'core',
    stringKeys: true,
    uniqueKeys: true,
  });
  const error = document.errors[0];
  if (error) throw new FrontmatterParseError(error.message, error.linePos?.[0].line);

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    throw new FrontmatterParseError(
      error instanceof Error ? error.message : 'Could not resolve YAML values.'
    );
  }
  if (value === null) return {};
  if (!isFrontmatterData(value)) {
    throw new FrontmatterParseError('Frontmatter must contain a mapping of portable YAML values.');
  }
  return value;
}

/**
 * Parses a leading YAML frontmatter section and returns its typed data plus exact body source.
 *
 * Documents without a delimiter pair are valid and return an empty data object. Invalid YAML
 * throws `FrontmatterParseError` so callers can preserve the source and use a raw editor fallback.
 */
export function parseFrontmatter(markdown: string): MarkdownDocument {
  const split = splitFrontmatter(markdown);
  if (!split.hasFrontmatter || !split.source) return { ...split, data: {} };

  const sourceLines = normalizedLineEnding(split.source).split('\n');
  if (sourceLines.at(-1) === '') sourceLines.pop();
  const payload = sourceLines.slice(1, -1).join('\n');
  return { ...split, data: parseYaml(payload) };
}

/** Serializes metadata to standard YAML frontmatter with a trailing newline. */
export function serializeFrontmatter(data: FrontmatterData): string {
  return `---\n${stringify(data, { lineWidth: 0 })}---\n`;
}

/** Reassembles a parsed document while preserving its original frontmatter source. */
export function composeMarkdown(document: MarkdownDocument, body = document.body): string {
  return `${document.source ?? ''}${body}`;
}
