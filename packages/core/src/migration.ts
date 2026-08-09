import { analyzeMarkdownCompatibility, type MarkdownCompatibilityIssue } from './compatibility.js';
import { normalizePageTitle, type PageInput, pageTitleFromPath } from './logseq.js';
import { findDuplicatePages } from './workspace.js';

/** A page with canonical metadata while retaining its exact source content. */
export interface NormalizedPage extends PageInput {
  sourceTitle: string;
  sourcePath: string;
  normalizedTitle: string;
  normalizedPath: string;
}

/** A file that was accepted by the migration analyser. */
export interface ConvertedFile {
  path: string;
  title: string;
  normalizedTitle: string;
  blockCount: number;
}

/** An unsupported Markdown construct found in a source page. */
export interface UnsupportedConstruct extends MarkdownCompatibilityIssue {
  path: string;
  title: string;
}

/** A malformed `[[page reference]]` occurrence. */
export interface MalformedPageReference {
  path: string;
  title: string;
  line: number;
  source: string;
  value: string;
  reason: string;
}

/** A duplicate normalized page name. */
export interface DuplicatePageName {
  normalizedTitle: string;
  pages: Array<{ title: string; path: string }>;
}

/** A block property key repeated with incompatible values. */
export interface ConflictingDuplicateBlockProperty {
  path: string;
  title: string;
  blockPath: number[];
  key: string;
  values: string[];
}

/** An attachment-like Markdown reference retained for migration review. */
export interface AttachmentReference {
  path: string;
  title: string;
  line: number;
  source: string;
  target: string;
}

/** Migration findings. All source content remains available in `pages`. */
export interface MigrationReport {
  convertedFiles: ConvertedFile[];
  unsupportedConstructs: UnsupportedConstruct[];
  malformedPageReferences: MalformedPageReference[];
  /** Short alias for malformedPageReferences. */
  malformedPageRefs: MalformedPageReference[];
  duplicatePageNames: DuplicatePageName[];
  /** Short alias for duplicatePageNames. */
  duplicateNames: DuplicatePageName[];
  conflictingDuplicateBlockProperties: ConflictingDuplicateBlockProperty[];
  /** Short alias for conflictingDuplicateBlockProperties. */
  conflictingDuplicateProperties: ConflictingDuplicateBlockProperty[];
  attachmentReferences: AttachmentReference[];
  /** Short alias for attachmentReferences. */
  attachments: AttachmentReference[];
}

/** Result of analysing and normalizing a collection of source pages. */
export interface MigrationResult {
  pages: NormalizedPage[];
  normalizedPages: NormalizedPage[];
  report: MigrationReport;
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

/** Normalizes page metadata without modifying the source Markdown content. */
export function normalizePageInput(page: PageInput): NormalizedPage {
  const title = page.title.trim() || pageTitleFromPath(page.path);
  return {
    ...page,
    sourceTitle: page.title,
    sourcePath: page.path,
    normalizedTitle: normalizePageTitle(title),
    normalizedPath: normalizedPath(page.path),
  };
}

/** Normalizes page metadata for a workspace without changing any page content. */
export function normalizePages(pages: readonly PageInput[]): NormalizedPage[] {
  return pages.map(normalizePageInput);
}

function lineNumberAt(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length;
}

function completeMalformedReferences(
  page: PageInput,
  content: string,
  completeRanges: [number, number][]
): MalformedPageReference[] {
  const findings: MalformedPageReference[] = [];
  for (const match of content.matchAll(/\[\[([^\]]*)\]\]/g)) {
    const start = match.index ?? 0;
    completeRanges.push([start, start + match[0].length]);
    const value = match[1] ?? '';
    const parts = value.split('|');
    let reason: string | undefined;
    if (!value.trim()) {
      reason = 'The page reference has no target.';
    } else if (parts.length > 2) {
      reason = 'A page reference can contain at most one alias separator.';
    } else if (parts.length === 2 && !parts[1]?.trim()) {
      reason = 'The page reference alias is empty.';
    }
    if (reason) {
      findings.push({
        path: page.path,
        title: page.title,
        line: lineNumberAt(content, start),
        source: match[0],
        value,
        reason,
      });
    }
  }
  return findings;
}

function incompleteMalformedReferences(
  page: PageInput,
  content: string,
  completeRanges: readonly [number, number][]
): MalformedPageReference[] {
  const findings: MalformedPageReference[] = [];
  for (const marker of ['[[', ']]'] as const) {
    let offset = content.indexOf(marker);
    while (offset !== -1) {
      const covered = completeRanges.some(([start, end]) => offset >= start && offset < end);
      if (!covered) {
        const line = content.slice(0, offset).split('\n').pop() ?? '';
        findings.push({
          path: page.path,
          title: page.title,
          line: lineNumberAt(content, offset),
          source: line,
          value: marker,
          reason:
            marker === '[['
              ? 'The page reference is not closed.'
              : 'The page reference has no opening marker.',
        });
      }
      offset = content.indexOf(marker, offset + 2);
    }
  }
  return findings;
}

function malformedReferences(page: PageInput): MalformedPageReference[] {
  const content = page.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const completeRanges: [number, number][] = [];
  return [
    ...completeMalformedReferences(page, content, completeRanges),
    ...incompleteMalformedReferences(page, content, completeRanges),
  ];
}

function blockPathByLines(content: string): Map<number, number[]> {
  const paths = new Map<number, number[]>();
  const stack: Array<{ indentation: number; path: number[] }> = [];
  const siblingCounts = new Map<string, number>();
  const lines = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  lines.forEach((line, index) => {
    const match = line.match(/^([ \t]*)[-*+]\s+(.*)$/u);
    if (!match) {
      return;
    }
    const indentation = (match[1] ?? '').replaceAll('\t', '  ').length;
    while (stack.length > 0 && (stack.at(-1)?.indentation ?? -1) >= indentation) {
      stack.pop();
    }
    const parent = stack.at(-1)?.path ?? [];
    const parentKey = parent.join('.');
    const position = siblingCounts.get(parentKey) ?? 0;
    siblingCounts.set(parentKey, position + 1);
    const path = [...parent, position];
    paths.set(index + 1, path);
    stack.push({ indentation, path });
  });
  return paths;
}

type ActiveBlock = { indentation: number; path: number[] };
type PropertyValues = Map<string, { path: number[]; values: string[] }>;

function inspectProperty(
  page: PageInput,
  line: string,
  active: readonly ActiveBlock[],
  values: PropertyValues,
  findingsByKey: Map<string, ConflictingDuplicateBlockProperty>,
  findings: ConflictingDuplicateBlockProperty[]
): void {
  const property = line.trim().match(/^([^:\n]+?)::\s*(.*)$/u);
  const current = active.at(-1);
  if (!property || !current) {
    return;
  }
  const key = property[1]?.trim();
  const value = property[2] ?? '';
  if (!key) {
    return;
  }
  const keyId = `${current.path.join('.')}\u0000${key.toLocaleLowerCase()}`;
  const existing = values.get(keyId);
  if (!existing) {
    values.set(keyId, { path: [...current.path], values: [value] });
    return;
  }
  if (existing.values.includes(value)) {
    return;
  }
  existing.values.push(value);
  const finding = findingsByKey.get(keyId);
  if (finding) {
    finding.values = [...existing.values];
    return;
  }
  const newFinding = {
    path: page.path,
    title: page.title,
    blockPath: existing.path,
    key,
    values: [...existing.values],
  };
  findings.push(newFinding);
  findingsByKey.set(keyId, newFinding);
}

function conflictingProperties(page: PageInput): ConflictingDuplicateBlockProperty[] {
  const lines = page.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const paths = blockPathByLines(page.content);
  const values = new Map<string, { path: number[]; values: string[] }>();
  const findingsByKey = new Map<string, ConflictingDuplicateBlockProperty>();
  const active: ActiveBlock[] = [];
  const findings: ConflictingDuplicateBlockProperty[] = [];

  lines.forEach((line, index) => {
    const bullet = line.match(/^([ \t]*)[-*+]\s+/u);
    if (bullet) {
      const indentation = (bullet[1] ?? '').replaceAll('\t', '  ').length;
      while (active.length > 0 && (active.at(-1)?.indentation ?? -1) >= indentation) {
        active.pop();
      }
      active.push({ indentation, path: paths.get(index + 1) ?? [] });
      return;
    }
    inspectProperty(page, line, active, values, findingsByKey, findings);
  });
  return findings;
}

function attachmentReferences(page: PageInput): AttachmentReference[] {
  const findings: AttachmentReference[] = [];
  const lines = page.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const pattern = /!?(?:\[[^\]]*\])\(([^)]+)\)|\{\{(?:video|audio|image)\s+([^}\s]+)[^}]*\}\}/giu;
  lines.forEach((source, index) => {
    for (const match of source.matchAll(pattern)) {
      const target = (match[1] ?? match[2])?.trim();
      if (
        target &&
        (/^(?:\.\.?\/|\/|assets?\/)/iu.test(target) ||
          /\.(?:png|jpe?g|gif|webp|svg|pdf|mp3|wav|mp4|mov|webm)$/iu.test(target))
      ) {
        findings.push({ path: page.path, title: page.title, line: index + 1, source, target });
      }
    }
  });
  return findings;
}

/** Analyses source pages and returns metadata-normalized pages with a lossless report. */
export function analyzePages(pages: readonly PageInput[]): MigrationResult {
  const normalizedPages = normalizePages(pages);
  const duplicates = findDuplicatePages(pages);
  const report: MigrationReport = {
    convertedFiles: normalizedPages.map((page) => ({
      path: page.path,
      title: page.title,
      normalizedTitle: page.normalizedTitle,
      blockCount: page.content.split('\n').filter((line) => /^\s*[-*+]\s+/u.test(line)).length,
    })),
    unsupportedConstructs: [],
    malformedPageReferences: [],
    malformedPageRefs: [],
    duplicatePageNames: duplicates.map((group) => ({
      normalizedTitle: group.normalizedTitle,
      pages: group.pages.map(({ title, path }) => ({ title, path })),
    })),
    duplicateNames: [],
    conflictingDuplicateBlockProperties: [],
    conflictingDuplicateProperties: [],
    attachmentReferences: [],
    attachments: [],
  };

  for (const page of normalizedPages) {
    const compatibility = analyzeMarkdownCompatibility(page.content);
    report.unsupportedConstructs.push(
      ...compatibility.issues.map((finding) => ({ ...finding, path: page.path, title: page.title }))
    );
    report.malformedPageReferences.push(...malformedReferences(page));
    report.conflictingDuplicateBlockProperties.push(...conflictingProperties(page));
    report.attachmentReferences.push(...attachmentReferences(page));
  }
  report.malformedPageRefs = report.malformedPageReferences;
  report.duplicateNames = report.duplicatePageNames;
  report.conflictingDuplicateProperties = report.conflictingDuplicateBlockProperties;
  report.attachments = report.attachmentReferences;
  return { pages: normalizedPages, normalizedPages, report };
}

/** Alias emphasizing that this operation is the lossless migration boundary. */
export const migratePages = analyzePages;

/** British-spelling alias for {@link analyzePages}. */
export const analysePages = analyzePages;

/** American-spelling alias emphasizing the migration boundary. */
export const analyzeMigration = analyzePages;

/** British-spelling alias for {@link analyzeMigration}. */
export const analyseMigration = analyzePages;
