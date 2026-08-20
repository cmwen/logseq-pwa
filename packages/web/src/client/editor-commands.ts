/**
 * Small, framework-independent editing commands used by both keyboard and
 * touch controls.  Keeping these operations pure makes it possible to keep
 * the textarea selection stable while the outliner updates its block model.
 */

export type EditorCommand =
  | 'page-link'
  | 'block-reference'
  | 'tag'
  | 'bold'
  | 'italic'
  | 'inline-code'
  | 'property'
  | 'cycle-task';

export interface TextSelection {
  start: number;
  end: number;
}

export interface TextEditResult {
  content: string;
  selection: TextSelection;
  /** Convenient aliases for DOM selection APIs. */
  selectionStart: number;
  selectionEnd: number;
}

const wrappers: Partial<Record<EditorCommand, readonly [string, string]>> = {
  'page-link': ['[[', ']]'],
  'block-reference': ['((', '))'],
  tag: ['#', ''],
  bold: ['**', '**'],
  italic: ['_', '_'],
  'inline-code': ['`', '`'],
};

/** Applies one Logseq-style command to a single textarea value. */
export function applyEditorCommand(
  command: EditorCommand,
  content: string,
  selection: TextSelection
): TextEditResult {
  const start = clamp(selection.start, 0, content.length);
  const end = clamp(selection.end, start, content.length);

  if (command === 'cycle-task') return cycleTask(content, { start, end });
  if (command === 'property') {
    const selected = content.slice(start, end);
    const next = `${content.slice(0, start)}${selected}:: ${content.slice(end)}`;
    const caret = end + 3;
    return result(next, { start: caret, end: caret });
  }

  const wrapper = wrappers[command];
  if (!wrapper) return result(content, { start, end });
  const [opening, closing] = wrapper;
  const selected = content.slice(start, end);
  const next = `${content.slice(0, start)}${opening}${selected}${closing}${content.slice(end)}`;
  const nextSelection = selected
    ? { start: start + opening.length, end: end + opening.length }
    : {
        start: start + opening.length,
        end: start + opening.length,
      };
  return result(next, nextSelection);
}

/** Alias that reads naturally at call sites which treat commands as edits. */
export const applyTextCommand = applyEditorCommand;

function cycleTask(content: string, selection: TextSelection): TextEditResult {
  const match = content.match(/^(TODO|DOING|DONE)([ \t]+)?/u);
  const status = match?.[1];
  const separator = match?.[2] ?? '';
  const body = match ? content.slice(match[0].length) : content;
  const nextStatus =
    status === undefined
      ? 'TODO'
      : status === 'TODO'
        ? 'DOING'
        : status === 'DOING'
          ? 'DONE'
          : undefined;

  if (nextStatus === undefined) {
    const removed = match?.[0].length ?? 0;
    return result(body, mapSelection(selection, 0, removed, 0));
  }

  const nextSeparator = separator || (body ? ' ' : '');
  const prefix = `${nextStatus}${nextSeparator}`;
  const next = `${prefix}${body}`;
  // A plain block receives a new prefix at offset zero, so every existing
  // caret/selection position moves after it. Status-to-status transitions
  // replace the existing marker and use replacement-aware mapping instead.
  const nextSelection =
    match === null
      ? { start: selection.start + prefix.length, end: selection.end + prefix.length }
      : mapSelection(selection, 0, match[0].length, prefix.length);
  return result(next, nextSelection);
}

function mapSelection(
  selection: TextSelection,
  replacementStart: number,
  replacedLength: number,
  replacementLength: number
): TextSelection {
  return {
    start: mapOffset(selection.start, replacementStart, replacedLength, replacementLength),
    end: mapOffset(selection.end, replacementStart, replacedLength, replacementLength),
  };
}

function mapOffset(offset: number, start: number, oldLength: number, newLength: number): number {
  if (offset <= start) return offset;
  if (offset >= start + oldLength) return offset + newLength - oldLength;
  return start + newLength;
}

function result(content: string, selection: TextSelection): TextEditResult {
  return {
    content,
    selection,
    selectionStart: selection.start,
    selectionEnd: selection.end,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
