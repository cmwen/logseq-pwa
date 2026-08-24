import { parseBlockMarkdown, serializeBlockMarkdown } from './blocks.js';
import {
  FrontmatterParseError,
  type MarkdownDocument,
  parseFrontmatter,
  splitFrontmatter,
} from './frontmatter.js';

/** A Markdown construct that the structured block serializer cannot preserve verbatim. */
export interface MarkdownCompatibilityIssue {
  /** The kind of syntax that would be changed. */
  kind:
    | 'heading'
    | 'ordered-list'
    | 'fenced-code'
    | 'table'
    | 'blockquote'
    | 'raw-markdown'
    | 'frontmatter';
  /** One-based source line containing the construct. */
  line: number;
  /** The original source line. */
  source: string;
  /** Why the structured serializer is unable to preserve it. */
  message: string;
}

/** The result of checking whether Markdown is safe for structured block round-tripping. */
export interface MarkdownCompatibilityReport {
  /** True when no known unsupported Markdown construct was found. */
  safe: boolean;
  /** True when parse/serialize produces the same normalized source text. */
  roundTrippable: boolean;
  /** Every known construct that would be changed, in source order. */
  issues: MarkdownCompatibilityIssue[];
  /** The serializer output, useful to callers showing a migration preview. */
  serialized: string;
}

const lineEnding = (markdown: string): string =>
  markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

function issue(
  kind: MarkdownCompatibilityIssue['kind'],
  line: number,
  source: string,
  message: string
): MarkdownCompatibilityIssue {
  return { kind, line, source, message };
}

function looksLikeTable(lines: readonly string[], index: number): boolean {
  const current = lines[index]?.trim() ?? '';
  const next = lines[index + 1]?.trim() ?? '';
  if (!current.includes('|') || !next.includes('|')) {
    return false;
  }
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/u.test(next);
}

function standardIssue(
  lines: readonly string[],
  index: number
): MarkdownCompatibilityIssue | undefined {
  const source = lines[index] ?? '';
  const line = index + 1;
  const trimmed = source.trim();
  if (/^#{1,6}(?:\s|$)/u.test(trimmed)) {
    return issue(
      'heading',
      line,
      source,
      'Headings are not represented by the structured bullet serializer.'
    );
  }
  if (/^\d+[.)]\s+/u.test(trimmed)) {
    return issue(
      'ordered-list',
      line,
      source,
      'Ordered list markers are not represented by the structured bullet serializer.'
    );
  }
  if (/^>\s?/u.test(trimmed)) {
    return issue(
      'blockquote',
      line,
      source,
      'Blockquote markers are not represented by the structured bullet serializer.'
    );
  }
  if (looksLikeTable(lines, index) || /^\s*\|.*\|\s*$/u.test(source)) {
    return issue(
      'table',
      line,
      source,
      'Pipe-delimited table content is not represented by the structured bullet serializer.'
    );
  }
  return undefined;
}

function findIssues(markdown: string, lineOffset = 0): MarkdownCompatibilityIssue[] {
  const lines = lineEnding(markdown).split('\n');
  const issues: MarkdownCompatibilityIssue[] = [];
  let inFence = false;

  lines.forEach((source, index) => {
    const line = index + 1 + lineOffset;
    const fence = /^\s*(```+|~~~+)/u.test(source);

    if (fence || inFence) {
      issues.push(
        issue(
          'fenced-code',
          line,
          source,
          'Fenced code is preserved as text but is not emitted as the same Markdown.'
        )
      );
      if (fence) {
        inFence = !inFence;
      }
      return;
    }
    const finding = standardIssue(lines, index);
    if (finding) {
      issues.push(finding);
    }
  });

  return issues;
}

/**
 * Analyses Markdown before structured editing or migration.
 *
 * The source is never changed by this helper. `roundTrippable` additionally checks the actual
 * parser and serializer output, catching syntax that is not safe even when it is not one of the
 * known construct patterns.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This safety gate combines parsing, source comparison, and diagnostics.
export function analyzeMarkdownCompatibility(markdown: string): MarkdownCompatibilityReport {
  const normalized = lineEnding(markdown);
  let document: MarkdownDocument;
  let frontmatterError: FrontmatterParseError | undefined;
  try {
    document = parseFrontmatter(normalized);
  } catch (error) {
    frontmatterError = error instanceof FrontmatterParseError ? error : undefined;
    const split = splitFrontmatter(normalized);
    document = { ...split, data: {} };
  }
  let blockNumber = 0;
  const blocks = parseBlockMarkdown(normalized, {
    idFactory: () => `compatibility-block-${blockNumber++}`,
  });
  const serializedBody = serializeBlockMarkdown(blocks);
  const serialized = `${document.source ?? ''}${serializedBody}`;
  const sourceForComparison =
    normalized.length === 0 || normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  const issues = findIssues(document.body, document.lineCount);
  if (frontmatterError) {
    issues.unshift(
      issue(
        'frontmatter',
        document.lineCount > 0 ? (frontmatterError.line ?? 1) + 1 : 1,
        normalized.split('\n')[frontmatterError.line ?? 0] ?? normalized,
        frontmatterError.message
      )
    );
  }
  if (issues.length === 0 && normalized.trim() && serialized !== sourceForComparison) {
    issues.push(
      issue(
        'raw-markdown',
        1,
        normalized.split('\n')[0] ?? '',
        'This Markdown is not in the portable bullet form emitted by the structured serializer.'
      )
    );
  }

  return {
    safe: issues.length === 0 && serialized === sourceForComparison,
    roundTrippable: serialized === sourceForComparison,
    issues,
    serialized,
  };
}

/** Returns whether structured block parsing and serialization can preserve this Markdown. */
export function isMarkdownRoundTripSafe(markdown: string): boolean {
  return analyzeMarkdownCompatibility(markdown).safe;
}

/** Alias for callers that treat the compatibility check as a safety gate. */
export const analyzeMarkdownSafety = analyzeMarkdownCompatibility;

/** Alias for {@link isMarkdownRoundTripSafe}. */
export const isMarkdownCompatibilitySafe = isMarkdownRoundTripSafe;

/** British-spelling alias for {@link analyzeMarkdownCompatibility}. */
export const analyseMarkdownCompatibility = analyzeMarkdownCompatibility;
