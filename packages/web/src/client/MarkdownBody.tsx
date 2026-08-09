import { flattenBlockTree } from '@loam/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { resolveLocalAttachment } from './logseq.js';
import {
  type MarkdownAlignment,
  type MarkdownNode,
  parseMarkdownDocument,
} from './markdown-model.js';
import { blockDomId } from './navigation-model.js';
import { assessOutlinerSafety, parseMarkdownBlocks, stableBlockId } from './outliner-model.js';

interface MarkdownInlineProps {
  imageSources: ReadonlyMap<string, string>;
  onLink: (target: string) => void;
  text: string;
}

function LinkGlyph() {
  return (
    <svg aria-hidden='true' className='inline-link-glyph' viewBox='0 0 24 24'>
      <path d='M10 13.5 14 10M7.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M16.5 6.5l1-1a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0' />
    </svg>
  );
}

function safeHref(value: string): string | null {
  const href = value.trim();
  if (
    !href ||
    href.split('').some((character) => character.charCodeAt(0) < 32) ||
    /^\/\//u.test(href)
  )
    return null;
  if (/^[a-z][a-z\d+.-]*:/iu.test(href) && !/^(?:https?:|mailto:|tel:|#)/iu.test(href)) {
    return null;
  }
  return href;
}

function localImageReferences(markdown: string): string[] {
  return [...markdown.matchAll(/!\[[^\]]*\]\((\S+?)(?:\s+["'][^"']*["'])?\)/gu)]
    .map((match) => match[1] ?? '')
    .filter((source) => !/^(?:https?:|data:|blob:|mailto:|tel:|#|\/\/)/iu.test(source));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The scanner keeps Markdown inline syntax and Logseq links in one ordered pass.
function InlineContent({ imageSources, text, onLink }: MarkdownInlineProps) {
  const output: ComponentChildren[] = [];
  let cursor = 0;
  let textBuffer = '';
  let tokenNumber = 0;

  const flushText = () => {
    if (textBuffer) {
      output.push(textBuffer);
      textBuffer = '';
    }
  };
  const key = (prefix: string) => `${prefix}-${tokenNumber++}`;

  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    let match: RegExpMatchArray | null;

    match = remaining.match(/^\[\[([^\]]+)\]\]/u);
    if (match) {
      flushText();
      const reference = match[1] ?? '';
      const [target, label] = reference.split('|');
      output.push(
        <button
          className='inline-link'
          key={key('page-link')}
          onClick={() => onLink(target?.trim() ?? '')}
          type='button'
        >
          <LinkGlyph />
          {label?.trim() || target?.trim()}
        </button>
      );
      cursor += match[0].length;
      continue;
    }

    match = remaining.match(/^#\[\[([^\]]+)\]\]/u);
    if (match) {
      flushText();
      output.push(
        <span className='tag' key={key('tag')}>
          #{match[1]}
        </span>
      );
      cursor += match[0].length;
      continue;
    }

    match = remaining.match(/^#([\w/-]+)/u);
    if (match) {
      flushText();
      output.push(
        <span className='tag' key={key('tag')}>
          #{match[1]}
        </span>
      );
      cursor += match[0].length;
      continue;
    }

    match = remaining.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/u);
    if (match) {
      flushText();
      const source = match[2] ?? '';
      const src = safeHref(source);
      const resolved = imageSources.get(source);
      const local = !/^(?:https?:|data:|blob:|\/\/)/iu.test(source);
      if (src && (!local || resolved)) {
        output.push(
          <img alt={match[1] ?? ''} key={key('image')} src={resolved ?? src} title={match[3]} />
        );
      } else {
        output.push(
          <span className='missing-attachment' key={key('missing-image')} title={source}>
            {match[1] || 'Missing local image'}
          </span>
        );
      }
      cursor += match[0].length;
      continue;
    }

    match = remaining.match(/^\[([^\]]+)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/u);
    if (match) {
      flushText();
      const href = safeHref(match[2] ?? '');
      output.push(
        href ? (
          <a href={href} key={key('link')} rel='noreferrer' target='_blank' title={match[3]}>
            {match[1]}
          </a>
        ) : (
          match[0]
        )
      );
      cursor += match[0].length;
      continue;
    }

    match = remaining.match(/^`([^`]+)`/u);
    if (match) {
      flushText();
      output.push(<code key={key('code')}>{match[1]}</code>);
      cursor += match[0].length;
      continue;
    }

    const styles: Array<{ pattern: RegExp; tag: 'strong' | 'em' | 'del' }> = [
      { pattern: /^\*\*([^*]+)\*\*/u, tag: 'strong' },
      { pattern: /^__([^_]+)__/u, tag: 'strong' },
      { pattern: /^~~([^~]+)~~/u, tag: 'del' },
      { pattern: /^\*([^*]+)\*/u, tag: 'em' },
      { pattern: /^_([^_]+)_/u, tag: 'em' },
    ];
    const styled = styles.find(({ pattern }) => pattern.test(remaining));
    if (styled) {
      match = remaining.match(styled.pattern);
      if (match) {
        flushText();
        const Tag = styled.tag;
        output.push(
          <Tag key={key(styled.tag)}>
            <InlineContent imageSources={imageSources} onLink={onLink} text={match[1] ?? ''} />
          </Tag>
        );
        cursor += match[0].length;
        continue;
      }
    }

    if (remaining.startsWith('  \n')) {
      flushText();
      output.push(<br key={key('break')} />);
      cursor += 3;
      continue;
    }

    textBuffer += text[cursor] ?? '';
    cursor += 1;
  }

  flushText();
  return <>{output}</>;
}

function alignmentStyle(alignment: MarkdownAlignment): { textAlign?: MarkdownAlignment } {
  return alignment ? { textAlign: alignment } : {};
}

function Table({
  table,
  imageSources,
  onLink,
}: {
  imageSources: ReadonlyMap<string, string>;
  onLink: MarkdownInlineProps['onLink'];
  table: Extract<MarkdownNode, { type: 'table' }>['table'];
}) {
  return (
    <div className='markdown-table-wrap'>
      <table className='markdown-table'>
        <thead>
          <tr>
            {table.headers.map((header, index) => (
              <th key={`header-${header}`} style={alignmentStyle(table.alignments[index] ?? null)}>
                <InlineContent imageSources={imageSources} onLink={onLink} text={header} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={`row-${row.join('|')}`}>
              {row.map((cell, cellIndex) => (
                <td
                  key={`cell-${row.join('|')}-${cell}`}
                  style={alignmentStyle(table.alignments[cellIndex] ?? null)}
                >
                  <InlineContent imageSources={imageSources} onLink={onLink} text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Markdown node rendering keeps each supported block shape in one ordered switch.
function renderNode(
  node: MarkdownNode,
  index: number,
  onLink: MarkdownInlineProps['onLink'],
  imageSources: ReadonlyMap<string, string>,
  blockIdForContent: (content: string) => string | undefined,
  focusedBlockId?: string
) {
  switch (node.type) {
    case 'blank':
      return <div className='blank-line' key={`blank-${index}`} />;
    case 'heading': {
      const Heading = `h${node.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Heading key={`heading-${index}`}>
          <InlineContent imageSources={imageSources} onLink={onLink} text={node.text} />
        </Heading>
      );
    }
    case 'table':
      return (
        <Table
          imageSources={imageSources}
          key={`table-${index}`}
          onLink={onLink}
          table={node.table}
        />
      );
    case 'code':
      return (
        <pre className='markdown-code' key={`code-${index}`}>
          <code data-language={node.language || undefined}>{node.value}</code>
        </pre>
      );
    case 'blockquote':
      return (
        <blockquote key={`quote-${index}`}>
          {node.lines.map((line) => (
            <p key={`quote-${line}`}>
              <InlineContent imageSources={imageSources} onLink={onLink} text={line} />
            </p>
          ))}
        </blockquote>
      );
    case 'hr':
      return <hr key={`hr-${index}`} />;
    case 'bullet': {
      const content = node.state ? `${node.state.toUpperCase()} ${node.text}` : node.text;
      const blockId = blockIdForContent(content);
      return (
        <div
          className={`page-block ${blockId === focusedBlockId ? 'page-block-focused' : ''}`.trim()}
          data-block-id={blockId}
          id={blockId ? blockDomId(blockId) : undefined}
          key={`bullet-${index}`}
          style={{ paddingLeft: `${node.indentation * 4}px` }}
          tabIndex={-1}
        >
          <span className={`bullet ${node.state === 'done' ? 'bullet-done' : ''}`}>
            {node.state === 'done' ? '✓' : ''}
          </span>
          {node.state && <span className={`task-state task-${node.state}`}>{node.state}</span>}
          <span>
            <InlineContent imageSources={imageSources} onLink={onLink} text={node.text} />
          </span>
        </div>
      );
    }
    case 'ordered': {
      const blockId = blockIdForContent(`${node.marker} ${node.text}`);
      return (
        <div
          className={`page-block ordered-block ${blockId === focusedBlockId ? 'page-block-focused' : ''}`.trim()}
          data-block-id={blockId}
          id={blockId ? blockDomId(blockId) : undefined}
          key={`ordered-${index}`}
          style={{ paddingLeft: `${node.indentation * 4}px` }}
          tabIndex={-1}
        >
          <span className='ordered-marker'>{node.marker}</span>
          <span>
            <InlineContent imageSources={imageSources} onLink={onLink} text={node.text} />
          </span>
        </div>
      );
    }
    case 'paragraph':
      return (
        <p className='page-paragraph' key={`paragraph-${index}`}>
          <InlineContent imageSources={imageSources} onLink={onLink} text={node.text} />
        </p>
      );
  }
}

export function MarkdownBody({
  markdown,
  onLink,
  pagePath = 'page',
  pageTitle = pagePath,
  root,
  focusedBlockId,
}: {
  markdown: string;
  onLink: (target: string) => void;
  pagePath?: string;
  pageTitle?: string;
  root?: FileSystemDirectoryHandle;
  focusedBlockId?: string;
}) {
  const nodes = useMemo(() => parseMarkdownDocument(markdown), [markdown]);
  const [imageSources, setImageSources] = useState<Map<string, string>>(() => new Map());
  const indexedBlocks = useMemo(
    () => flattenBlockTree(parseMarkdownBlocks(markdown, pagePath, pageTitle)),
    [markdown, pagePath, pageTitle]
  );
  const blockIdsByContent = useMemo(() => {
    const ids = new Map<string, string[]>();
    for (const block of indexedBlocks) {
      const current = ids.get(block.content) ?? [];
      current.push(block.id);
      ids.set(block.content, current);
    }
    return ids;
  }, [indexedBlocks]);
  const safeOutlinerDocument = useMemo(() => assessOutlinerSafety(markdown).safe, [markdown]);
  let safeBlockCursor = 0;
  const usedBlockContents = new Map<string, number>();
  const blockIdForContent = (content: string) => {
    if (safeOutlinerDocument) {
      const id = indexedBlocks[safeBlockCursor]?.id;
      safeBlockCursor += 1;
      if (id) return id;
    }
    const occurrence = usedBlockContents.get(content) ?? 0;
    usedBlockContents.set(content, occurrence + 1);
    return (
      blockIdsByContent.get(content)?.[occurrence] ?? stableBlockId(pagePath, content, occurrence)
    );
  };

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    const references = localImageReferences(markdown);
    if (!root || references.length === 0) {
      setImageSources(new Map());
      return () => undefined;
    }
    void Promise.all(
      references.map(async (source) => {
        let file: File | null = null;
        try {
          file = await resolveLocalAttachment(root, pagePath, source);
        } catch {
          return [source, ''] as const;
        }
        if (!file) return [source, ''] as const;
        const url = URL.createObjectURL(file);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return [source, ''] as const;
        }
        objectUrls.push(url);
        return [source, url] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setImageSources(new Map(entries.filter(([, url]) => url)));
    });
    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [markdown, pagePath, root]);

  const focusToken = useMemo(
    () => `${focusedBlockId ?? ''}:${markdown}`,
    [focusedBlockId, markdown]
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusToken includes the exact source so a rerender scrolls the selected block again.
  useEffect(() => {
    if (!focusedBlockId) return;
    const timer = window.setTimeout(() => {
      const element = document.getElementById(blockDomId(focusedBlockId));
      element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusedBlockId, focusToken]);

  return (
    <div className='page-body'>
      {nodes.map((node, index) =>
        renderNode(node, index, onLink, imageSources, blockIdForContent, focusedBlockId)
      )}
    </div>
  );
}
