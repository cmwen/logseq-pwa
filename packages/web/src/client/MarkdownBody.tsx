import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import {
  type MarkdownAlignment,
  type MarkdownNode,
  parseMarkdownDocument,
} from './markdown-model.js';

interface MarkdownInlineProps {
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
  if (/^(?:https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/iu.test(href)) return href;
  return null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The scanner keeps Markdown inline syntax and Logseq links in one ordered pass.
function InlineContent({ text, onLink }: MarkdownInlineProps) {
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
      const src = safeHref(match[2] ?? '');
      if (src) {
        output.push(<img alt={match[1] ?? ''} key={key('image')} src={src} title={match[3]} />);
      } else {
        output.push(match[0]);
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
            <InlineContent onLink={onLink} text={match[1] ?? ''} />
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
  onLink,
}: {
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
                <InlineContent onLink={onLink} text={header} />
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
                  <InlineContent onLink={onLink} text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderNode(node: MarkdownNode, index: number, onLink: MarkdownInlineProps['onLink']) {
  switch (node.type) {
    case 'blank':
      return <div className='blank-line' key={`blank-${index}`} />;
    case 'heading': {
      const Heading = `h${node.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Heading key={`heading-${index}`}>
          <InlineContent onLink={onLink} text={node.text} />
        </Heading>
      );
    }
    case 'table':
      return <Table key={`table-${index}`} onLink={onLink} table={node.table} />;
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
              <InlineContent onLink={onLink} text={line} />
            </p>
          ))}
        </blockquote>
      );
    case 'hr':
      return <hr key={`hr-${index}`} />;
    case 'bullet':
      return (
        <div
          className='page-block'
          key={`bullet-${index}`}
          style={{ paddingLeft: `${node.indentation * 4}px` }}
        >
          <span className={`bullet ${node.state === 'done' ? 'bullet-done' : ''}`}>
            {node.state === 'done' ? '✓' : ''}
          </span>
          {node.state && <span className={`task-state task-${node.state}`}>{node.state}</span>}
          <span>
            <InlineContent onLink={onLink} text={node.text} />
          </span>
        </div>
      );
    case 'ordered':
      return (
        <div
          className='page-block ordered-block'
          key={`ordered-${index}`}
          style={{ paddingLeft: `${node.indentation * 4}px` }}
        >
          <span className='ordered-marker'>{node.marker}</span>
          <span>
            <InlineContent onLink={onLink} text={node.text} />
          </span>
        </div>
      );
    case 'paragraph':
      return (
        <p className='page-paragraph' key={`paragraph-${index}`}>
          <InlineContent onLink={onLink} text={node.text} />
        </p>
      );
  }
}

export function MarkdownBody({
  markdown,
  onLink,
}: {
  markdown: string;
  onLink: (target: string) => void;
}) {
  const nodes = useMemo(() => parseMarkdownDocument(markdown), [markdown]);
  return (
    <div className='page-body'>{nodes.map((node, index) => renderNode(node, index, onLink))}</div>
  );
}
