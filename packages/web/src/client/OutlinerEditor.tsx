import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { markdownFromClipboard } from './clipboard-markdown.js';
import {
  applyDateReference,
  applyEditorCommand,
  type EditorCommand,
  isCaretOnBlockBoundaryLine,
} from './editor-commands.js';
import {
  addSiblingBlock,
  type BlockMutation,
  canIndent,
  canIndentBlocks,
  canMove,
  canOutdent,
  canOutdentBlocks,
  createBlock,
  deleteBlock,
  dropBlock,
  extendKeyboardBlockSelection,
  findBlock,
  focusBlockTree,
  indentBlock,
  indentBlocks,
  mergeBlockBackward,
  moveBlock,
  type OutlinerBlock,
  outdentBlock,
  outdentBlocks,
  pasteMarkdownBlocks,
  selectVisibleBlockRange,
  splitBlock,
  toggleBlockCollapsed,
  updateBlockContent,
  visibleBlockIds,
} from './outliner-model.js';
import './outliner.css';

export interface OutlinerEditorProps {
  blocks: readonly OutlinerBlock[];
  onChange: (blocks: OutlinerBlock[]) => void;
  ariaLabel?: string;
  className?: string;
  readOnly?: boolean;
  focusedBlockId?: string;
  onExitFocus?: () => void;
}

interface FocusRequest {
  id: string;
  caret?: number;
}

interface BlockTreeProps {
  blocks: readonly OutlinerBlock[];
  activeId?: string;
  draggedId?: string;
  menuId?: string;
  selectedIds: ReadonlySet<string>;
  readOnly: boolean;
  onActivate: (id: string) => void;
  onInput: (id: string, content: string) => void;
  onKeyDown: (event: KeyboardEvent, block: OutlinerBlock) => void;
  onPaste: (event: ClipboardEvent, block: OutlinerBlock) => void;
  onAction: (action: BlockAction, id: string) => void;
  onMenu: (id: string) => void;
  onSelect: (id: string, range: boolean) => void;
  registerInput: (id: string, element: HTMLTextAreaElement | null) => void;
  onDrop: (draggedId: string, targetId: string, placement: 'before' | 'after' | 'inside') => void;
  onDragState: (id?: string) => void;
}

type BlockAction = 'add' | 'collapse' | 'delete' | 'indent' | 'outdent' | 'up' | 'down';

export function OutlinerEditor({
  blocks: controlledBlocks,
  onChange,
  ariaLabel = 'Block editor',
  className = '',
  readOnly = false,
  focusedBlockId,
  onExitFocus,
}: OutlinerEditorProps) {
  const initialBlocks = controlledBlocks.length ? controlledBlocks : [createBlock()];
  const [blocks, setBlocks] = useState<OutlinerBlock[]>(() => [...initialBlocks]);
  const [activeId, setActiveId] = useState<string | undefined>(initialBlocks[0]?.id);
  const [menuId, setMenuId] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string>();
  const [keyboardSelectionActive, setKeyboardSelectionActive] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>();
  const [dateValue, setDateValue] = useState(() => formatDateInputValue(new Date()));
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const past = useRef<OutlinerBlock[][]>([]);
  const future = useRef<OutlinerBlock[][]>([]);
  const emitted = useRef<readonly OutlinerBlock[]>(controlledBlocks);
  const currentBlocks = useRef(blocks);
  const [draggedId, setDraggedId] = useState<string>();

  useEffect(() => {
    currentBlocks.current = blocks;
  }, [blocks]);

  useEffect(() => {
    if (controlledBlocks === emitted.current) return;
    const next = controlledBlocks.length ? [...controlledBlocks] : [createBlock()];
    setBlocks(next);
    currentBlocks.current = next;
    past.current = [];
    future.current = [];
    setActiveId(next[0]?.id);
    setSelectedIds(new Set());
    setSelectionAnchorId(undefined);
    setKeyboardSelectionActive(false);
  }, [controlledBlocks]);

  useEffect(() => {
    if (!focusedBlockId || !findBlock(blocks, focusedBlockId)) return;
    setActiveId(focusedBlockId);
    setFocusRequest({ id: focusedBlockId });
  }, [focusedBlockId, blocks]);

  useEffect(() => {
    if (!focusRequest) return;
    const input = inputs.current.get(focusRequest.id);
    if (!input) return;
    input.focus();
    const caret = Math.min(focusRequest.caret ?? input.value.length, input.value.length);
    input.setSelectionRange(caret, caret);
    resizeInput(input);
    setFocusRequest(undefined);
  }, [focusRequest]);

  useEffect(() => {
    for (const input of inputs.current.values()) resizeInput(input);
  });

  const commit = (next: OutlinerBlock[], focus?: FocusRequest, record = true) => {
    if (record) {
      past.current = [...past.current.slice(-99), currentBlocks.current];
      future.current = [];
    }
    setBlocks(next);
    currentBlocks.current = next;
    emitted.current = next;
    onChange(next);
    if (focus) {
      setActiveId(focus.id);
      setFocusRequest(focus);
    }
  };

  const applyMutation = (mutation: BlockMutation) => {
    if (!mutation.changed) {
      if (mutation.focusId) setFocusRequest({ id: mutation.focusId, caret: mutation.caret });
      return;
    }
    commit(
      mutation.blocks,
      mutation.focusId ? { id: mutation.focusId, caret: mutation.caret } : undefined
    );
    setSelectedIds((current) => {
      const available = new Set(flattenAllBlockIds(mutation.blocks));
      return new Set([...current].filter((id) => available.has(id)));
    });
    setSelectionAnchorId((current) => {
      if (!current) return undefined;
      return flattenAllBlockIds(mutation.blocks).includes(current) ? current : undefined;
    });
    if (focusedBlockId && !findBlock(mutation.blocks, focusedBlockId)) onExitFocus?.();
  };

  const focusInSnapshot = (snapshot: readonly OutlinerBlock[]): FocusRequest | undefined => {
    if (activeId && findBlock(snapshot, activeId)) return { id: activeId };
    const first = snapshot[0];
    return first ? { id: first.id, caret: first.content.length } : undefined;
  };

  const undo = () => {
    const previous = past.current.at(-1);
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [currentBlocks.current, ...future.current].slice(0, 100);
    commit(previous, focusInSnapshot(previous), false);
  };

  const redo = () => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current.slice(-99), currentBlocks.current];
    commit(next, focusInSnapshot(next), false);
  };

  const handleInput = (id: string, content: string) => {
    setKeyboardSelectionActive(false);
    const next = updateBlockContent(currentBlocks.current, id, content);
    commit(next);
  };

  const applyTextCommand = (command: EditorCommand, id = activeId) => {
    if (readOnly || !id) return;
    const block = findBlock(currentBlocks.current, id);
    const input = inputs.current.get(id);
    if (!block || !input) return;
    const edit = applyEditorCommand(command, input.value, {
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    });
    if (edit.content === input.value) return;
    commit(updateBlockContent(currentBlocks.current, id, edit.content), {
      id,
      caret: edit.selectionStart,
    });
    // A selection (rather than only a caret) is useful after applying a
    // formatting command. The normal focus effect uses a caret for structural
    // edits, so restore the full range on the next frame here.
    const restoreSelection = () => {
      const nextInput = inputs.current.get(id);
      if (!nextInput) return;
      nextInput.focus();
      nextInput.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreSelection);
    else restoreSelection();
  };

  const applyDateCommand = (date: string, id = activeId) => {
    if (readOnly || !id || !date) return;
    const block = findBlock(currentBlocks.current, id);
    const input = inputs.current.get(id);
    if (!block || !input) return;
    const edit = applyDateReference(
      input.value,
      {
        start: input.selectionStart ?? input.value.length,
        end: input.selectionEnd ?? input.value.length,
      },
      date
    );
    if (edit.content === input.value) return;
    commit(updateBlockContent(currentBlocks.current, id, edit.content), {
      id,
      caret: edit.selectionStart,
    });
  };

  const handlePaste = (event: ClipboardEvent, block: OutlinerBlock) => {
    if (readOnly || !event.clipboardData) return;
    const html = event.clipboardData.getData('text/html');
    const markdown = markdownFromClipboard({
      html,
      text: event.clipboardData.getData('text/plain'),
    });
    if (!markdown) return;

    event.preventDefault();
    const input = event.currentTarget as HTMLTextAreaElement;
    applyMutation(
      pasteMarkdownBlocks(
        currentBlocks.current,
        block.id,
        {
          start: input.selectionStart ?? block.content.length,
          end: input.selectionEnd ?? block.content.length,
        },
        markdown,
        { groupRichText: Boolean(html) }
      )
    );
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keyboard commands are kept together so their precedence is explicit.
  const handleKeyDown = (event: KeyboardEvent, block: OutlinerBlock) => {
    if (readOnly) return;
    const input = event.currentTarget as HTMLTextAreaElement;
    const command = event.metaKey || event.ctrlKey;

    // Let the IME finish composing its candidate before treating Enter as a
    // block command. Some mobile keyboards report this as keyCode 229.
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      if (selectedIds.size > 0) {
        setSelectedIds(new Set());
        setSelectionAnchorId(undefined);
        setKeyboardSelectionActive(false);
        return;
      }
      input.blur();
      setActiveId(undefined);
      setMenuId(undefined);
      return;
    }

    if (command && event.key.toLocaleLowerCase() === 'b') {
      event.preventDefault();
      applyTextCommand('bold', block.id);
      return;
    }
    if (command && event.key.toLocaleLowerCase() === 'i') {
      event.preventDefault();
      applyTextCommand('italic', block.id);
      return;
    }
    if (command && event.shiftKey && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      applyTextCommand('page-link', block.id);
      return;
    }
    if (command && event.shiftKey && event.key.toLocaleLowerCase() === 'a') {
      event.preventDefault();
      const ids = visibleBlockIds(visibleBlocks);
      const first = ids[0];
      const last = ids.at(-1);
      if (!first || !last) return;
      setSelectedIds(new Set(ids));
      setSelectionAnchorId(first);
      setKeyboardSelectionActive(true);
      setActiveId(last);
      setFocusRequest({
        id: last,
        caret: findBlock(currentBlocks.current, last)?.content.length ?? 0,
      });
      return;
    }
    if (command && event.key === 'Enter') {
      event.preventDefault();
      applyTextCommand('cycle-task', block.id);
      return;
    }

    if (command && event.key.toLocaleLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (command && event.key.toLocaleLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (
      (event.altKey || (event.metaKey && event.shiftKey)) &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      applyMutation(moveBlock(currentBlocks.current, block.id, event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    // Shift+Arrow selects whole visible blocks only at the textarea boundary.
    // Inside a multiline block, the browser keeps its normal text-selection
    // behavior (including line-wise Shift+Arrow movement).
    if (
      !command &&
      !event.altKey &&
      event.shiftKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      input.selectionStart === input.selectionEnd &&
      (isCaretOnBlockBoundaryLine(
        input.value,
        input.selectionStart,
        event.key === 'ArrowUp' ? -1 : 1
      ) ||
        (keyboardSelectionActive &&
          selectedIds.size > 0 &&
          selectionAnchorId &&
          activeId === block.id))
    ) {
      const selection = extendKeyboardBlockSelection(
        visibleBlocks,
        selectionAnchorId,
        block.id,
        event.key === 'ArrowUp' ? -1 : 1
      );
      if (selection) {
        event.preventDefault();
        setSelectedIds(new Set(selection.ids));
        setSelectionAnchorId(selection.anchorId);
        setKeyboardSelectionActive(true);
        setActiveId(selection.focusId);
        const focusBlock = findBlock(currentBlocks.current, selection.focusId);
        setFocusRequest({
          id: selection.focusId,
          caret: event.key === 'ArrowUp' ? 0 : (focusBlock?.content.length ?? 0),
        });
        return;
      }
    }
    if (
      !command &&
      !event.shiftKey &&
      !event.altKey &&
      event.key === 'ArrowUp' &&
      input.selectionStart === 0 &&
      input.selectionEnd === 0
    ) {
      const previous = adjacentVisibleBlock(block.id, visibleBlocks, -1);
      if (previous) {
        event.preventDefault();
        setActiveId(previous.id);
        setFocusRequest({ id: previous.id, caret: previous.content.length });
      }
      return;
    }
    if (
      !command &&
      !event.shiftKey &&
      !event.altKey &&
      event.key === 'ArrowDown' &&
      input.selectionStart === input.value.length &&
      input.selectionEnd === input.value.length
    ) {
      const next = adjacentVisibleBlock(block.id, visibleBlocks, 1);
      if (next) {
        event.preventDefault();
        setActiveId(next.id);
        setFocusRequest({ id: next.id, caret: 0 });
      }
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const selected = selectedIds.size > 1 && selectedIds.has(block.id);
      applyMutation(
        event.shiftKey
          ? selected
            ? outdentBlocks(currentBlocks.current, [...selectedIds])
            : outdentBlock(currentBlocks.current, block.id)
          : selected
            ? indentBlocks(currentBlocks.current, [...selectedIds])
            : indentBlock(currentBlocks.current, block.id)
      );
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const start = input.selectionStart ?? block.content.length;
      const end = input.selectionEnd ?? start;
      if (
        start === 0 &&
        end === block.content.length &&
        !block.content &&
        block.parentId !== null
      ) {
        applyMutation(outdentBlock(currentBlocks.current, block.id));
        return;
      }
      applyMutation(
        splitBlock(
          currentBlocks.current,
          block.id,
          block.content.slice(0, start),
          block.content.slice(end)
        )
      );
      return;
    }
    if (event.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0) {
      const mutation = block.content
        ? mergeBlockBackward(currentBlocks.current, block.id)
        : deleteBlock(currentBlocks.current, block.id, true);
      if (mutation.changed) event.preventDefault();
      applyMutation(mutation);
    }
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This is a direct dispatch table for the compact block command surface.
  const handleAction = (action: BlockAction, id: string) => {
    if (readOnly) return;
    const current = currentBlocks.current;
    if (action === 'add') applyMutation(addSiblingBlock(current, id));
    if (action === 'indent') {
      applyMutation(
        selectedIds.size > 1 && selectedIds.has(id)
          ? indentBlocks(current, [...selectedIds])
          : indentBlock(current, id)
      );
    }
    if (action === 'outdent') {
      applyMutation(
        selectedIds.size > 1 && selectedIds.has(id)
          ? outdentBlocks(current, [...selectedIds])
          : outdentBlock(current, id)
      );
    }
    if (action === 'up') applyMutation(moveBlock(current, id, -1));
    if (action === 'down') applyMutation(moveBlock(current, id, 1));
    if (action === 'collapse') applyMutation(toggleBlockCollapsed(current, id));
    if (action === 'delete') {
      const block = findBlock(current, id);
      const shouldDelete =
        !block?.children.length ||
        window.confirm('Delete this block and all of its nested blocks? This can be undone.');
      if (shouldDelete) applyMutation(deleteBlock(current, id));
    }
    setMenuId(undefined);
  };

  const handleSelect = (id: string, range: boolean) => {
    setActiveId(id);
    setKeyboardSelectionActive(false);
    const rangeAnchor =
      range &&
      selectionAnchorId &&
      selectVisibleBlockRange(visibleBlocks, selectionAnchorId, id).length
        ? selectionAnchorId
        : id;
    setSelectedIds((current) => nextSelectedIds(current, id, range, rangeAnchor, visibleBlocks));
    setSelectionAnchorId(rangeAnchor);
  };

  const handleDrop = (
    dragged: string,
    target: string,
    placement: 'before' | 'after' | 'inside'
  ) => {
    if (readOnly) return;
    applyMutation(dropBlock(currentBlocks.current, dragged, target, placement));
    setDraggedId(undefined);
  };

  const registerInput = (id: string, element: HTMLTextAreaElement | null) => {
    if (element) {
      inputs.current.set(id, element);
      resizeInput(element);
    } else {
      inputs.current.delete(id);
    }
  };

  const active = useMemo(
    () => (activeId ? findBlock(blocks, activeId) : undefined),
    [activeId, blocks]
  );
  const visibleBlocks = focusedBlockId ? focusBlockTree(blocks, focusedBlockId) : blocks;

  return (
    <section
      aria-label={ariaLabel}
      className={`outliner ${readOnly ? 'outliner-readonly' : ''} ${className}`.trim()}
    >
      {!readOnly && (
        <div
          aria-live='polite'
          className='outliner-selection-status'
          id='outliner-selection-status'
        >
          {selectedIds.size > 0
            ? `${selectedIds.size} block${selectedIds.size === 1 ? '' : 's'} selected. Use Tab to indent or Shift+Tab to outdent.`
            : ''}
        </div>
      )}
      <div className='outliner-tree'>
        {focusedBlockId && (
          <div className='outliner-focus-breadcrumb'>
            <span aria-hidden='true'>Focus</span>
            <span className='outliner-focus-label'>{active?.content || 'Selected block'}</span>
            {onExitFocus && (
              <button onClick={onExitFocus} type='button'>
                Exit focus
              </button>
            )}
          </div>
        )}
        <BlockTree
          activeId={activeId}
          blocks={visibleBlocks}
          draggedId={draggedId}
          menuId={menuId}
          onAction={handleAction}
          onActivate={(id) => setActiveId(id)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onMenu={(id) => setMenuId((current) => (current === id ? undefined : id))}
          onSelect={handleSelect}
          readOnly={readOnly}
          registerInput={registerInput}
          selectedIds={selectedIds}
          onDrop={handleDrop}
          onDragState={setDraggedId}
        />
      </div>

      {!readOnly && active && (
        <div
          aria-label='Editing commands'
          className='outliner-mobile-toolbar'
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button')) {
              // Keep the textarea selection and the software keyboard alive
              // while a touch command is being pressed.
              event.preventDefault();
              inputs.current.get(active.id)?.focus();
            }
          }}
          role='toolbar'
        >
          <ToolbarGroup label='Insert'>
            <ActionButton
              label='Insert page link'
              onClick={() => applyTextCommand('page-link')}
              text='[[ ]]'
            />
            <ActionButton
              label='Insert block reference'
              onClick={() => applyTextCommand('block-reference')}
              text='(( ))'
            />
            <ActionButton label='Insert tag' onClick={() => applyTextCommand('tag')} text='@' />
            <label className='outliner-date-picker'>
              <span className='outliner-date-picker-label'>Date</span>
              <input
                aria-label='Date to insert'
                onInput={(event) => setDateValue(event.currentTarget.value)}
                type='date'
                value={dateValue}
              />
            </label>
            <ActionButton
              label='Insert date'
              onClick={() => applyDateCommand(dateValue)}
              text='DATE'
            />
            <ActionButton
              label='Cycle task status'
              onClick={() => applyTextCommand('cycle-task')}
              text='TODO'
            />
          </ToolbarGroup>
          <ToolbarGroup label='Format'>
            <ActionButton label='Bold' onClick={() => applyTextCommand('bold')} text='B' />
            <ActionButton label='Italic' onClick={() => applyTextCommand('italic')} text='I' />
            <ActionButton
              label='Inline code'
              onClick={() => applyTextCommand('inline-code')}
              text='`x`'
            />
            <ActionButton
              label='Insert property'
              onClick={() => applyTextCommand('property')}
              text='::'
            />
          </ToolbarGroup>
          <ToolbarGroup label='Structure'>
            <ActionButton
              disabled={!canOutdent(blocks, active.id)}
              label='Outdent block'
              onClick={() => handleAction('outdent', active.id)}
              text='←'
            />
            <ActionButton
              disabled={!canIndent(blocks, active.id)}
              label='Indent block'
              onClick={() => handleAction('indent', active.id)}
              text='→'
            />
            <ActionButton
              label='Add block'
              onClick={() => handleAction('add', active.id)}
              text='＋'
            />
            <ActionButton
              disabled={!canMove(blocks, active.id, -1)}
              label='Move block up'
              onClick={() => handleAction('up', active.id)}
              text='↑'
            />
            <ActionButton
              disabled={!canMove(blocks, active.id, 1)}
              label='Move block down'
              onClick={() => handleAction('down', active.id)}
              text='↓'
            />
            {active.children.length > 0 && (
              <ActionButton
                label={active.collapsed ? 'Expand block' : 'Collapse block'}
                onClick={() => handleAction('collapse', active.id)}
                text={active.collapsed ? '▸' : '▾'}
              />
            )}
          </ToolbarGroup>
          {selectedIds.size > 1 && (
            <ToolbarGroup label={`${selectedIds.size} selected blocks`}>
              <ActionButton
                disabled={!canOutdentBlocks(blocks, [...selectedIds])}
                label='Outdent selected blocks'
                onClick={() => {
                  applyMutation(outdentBlocks(blocks, [...selectedIds]));
                  setMenuId(undefined);
                }}
                text='⇤'
              />
              <ActionButton
                disabled={!canIndentBlocks(blocks, [...selectedIds])}
                label='Indent selected blocks'
                onClick={() => {
                  applyMutation(indentBlocks(blocks, [...selectedIds]));
                  setMenuId(undefined);
                }}
                text='⇥'
              />
              <ActionButton
                label='Clear block selection'
                onClick={() => setSelectedIds(new Set())}
                text='×'
              />
            </ToolbarGroup>
          )}
        </div>
      )}
    </section>
  );
}

function BlockTree({
  blocks,
  activeId,
  draggedId,
  menuId,
  selectedIds,
  readOnly,
  onActivate,
  onInput,
  onKeyDown,
  onPaste,
  onAction,
  onMenu,
  onSelect,
  registerInput,
  onDrop,
  onDragState,
}: BlockTreeProps) {
  return (
    <>
      {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Recursive block rendering keeps each stable block and its controls colocated. */}
      {blocks.map((block) => {
        const hasChildren = block.children.length > 0;
        const active = activeId === block.id;
        return (
          <div className='outliner-branch' key={block.id}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: The row is a draggable handle while its controls remain keyboard-accessible. */}
            <div
              className={`outliner-row ${active ? 'outliner-row-active' : ''} ${selectedIds.has(block.id) ? 'outliner-row-selected' : ''} ${draggedId === block.id ? 'outliner-row-dragging' : ''}`.trim()}
              draggable={!readOnly}
              onDragOver={(event) => {
                if (!readOnly && draggedId && draggedId !== block.id) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedId) {
                  const placement = event.altKey
                    ? 'inside'
                    : event.clientY <
                        event.currentTarget.getBoundingClientRect().top +
                          event.currentTarget.getBoundingClientRect().height / 2
                      ? 'before'
                      : 'after';
                  onDrop(draggedId, block.id, placement);
                }
              }}
              onDragEnd={() => onDragState(undefined)}
              onDragStart={(event) => {
                if (readOnly) return;
                onDragState(block.id);
                event.dataTransfer?.setData('text/plain', block.id);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
              }}
            >
              {!readOnly && (
                <input
                  aria-label={`Select block${block.content ? `: ${block.content}` : ''}`}
                  checked={selectedIds.has(block.id)}
                  className='outliner-select'
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect(block.id, event.shiftKey);
                  }}
                  onChange={() => undefined}
                  type='checkbox'
                />
              )}
              <button
                aria-label={
                  hasChildren
                    ? block.collapsed
                      ? 'Expand nested blocks'
                      : 'Collapse nested blocks'
                    : 'Block bullet'
                }
                className={`outliner-bullet ${hasChildren ? 'outliner-bullet-parent' : ''}`}
                disabled={!hasChildren}
                onClick={() => onAction('collapse', block.id)}
                type='button'
              >
                {hasChildren ? (block.collapsed ? '▸' : '▾') : '•'}
              </button>
              <textarea
                aria-label='Block content'
                aria-describedby='outliner-selection-status'
                aria-keyshortcuts='Shift+ArrowUp Shift+ArrowDown Tab Shift+Tab Meta+Shift+A Control+Shift+A'
                className='outliner-input'
                onFocus={() => onActivate(block.id)}
                onInput={(event) => {
                  resizeInput(event.currentTarget);
                  onInput(block.id, event.currentTarget.value);
                }}
                onKeyDown={(event) => onKeyDown(event, block)}
                onPaste={(event) => onPaste(event, block)}
                readOnly={readOnly}
                ref={(element) => registerInput(block.id, element)}
                rows={1}
                value={block.content}
              />
              {!readOnly && (
                <button
                  aria-expanded={menuId === block.id}
                  aria-label='Block actions'
                  className='outliner-handle'
                  onClick={() => {
                    onActivate(block.id);
                    onMenu(block.id);
                  }}
                  type='button'
                >
                  •••
                </button>
              )}
              {!readOnly && menuId === block.id && (
                <div aria-label='Actions for block' className='outliner-menu' role='toolbar'>
                  <ActionButton
                    label='Add sibling block'
                    onClick={() => onAction('add', block.id)}
                    text='＋'
                  />
                  <ActionButton
                    label='Indent block'
                    onClick={() => onAction('indent', block.id)}
                    text='→'
                  />
                  <ActionButton
                    label='Outdent block'
                    onClick={() => onAction('outdent', block.id)}
                    text='←'
                  />
                  {hasChildren && (
                    <ActionButton
                      label={block.collapsed ? 'Expand block' : 'Collapse block'}
                      onClick={() => onAction('collapse', block.id)}
                      text={block.collapsed ? '▸' : '▾'}
                    />
                  )}
                  <ActionButton
                    label='Move block up'
                    onClick={() => onAction('up', block.id)}
                    text='↑'
                  />
                  <ActionButton
                    label='Move block down'
                    onClick={() => onAction('down', block.id)}
                    text='↓'
                  />
                  <ActionButton
                    label='Delete block'
                    onClick={() => onAction('delete', block.id)}
                    text='×'
                  />
                </div>
              )}
            </div>
            {hasChildren && !block.collapsed && (
              <div className='outliner-children'>
                <BlockTree
                  activeId={activeId}
                  blocks={block.children}
                  draggedId={draggedId}
                  menuId={menuId}
                  onAction={onAction}
                  onActivate={onActivate}
                  onInput={onInput}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  onMenu={onMenu}
                  onSelect={onSelect}
                  readOnly={readOnly}
                  registerInput={registerInput}
                  selectedIds={selectedIds}
                  onDrop={onDrop}
                  onDragState={onDragState}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function ActionButton({
  disabled = false,
  label,
  onClick,
  text,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
  text: string;
}) {
  return (
    <button aria-label={label} disabled={disabled} onClick={onClick} title={label} type='button'>
      <span aria-hidden='true'>{text}</span>
    </button>
  );
}

function ToolbarGroup({ children, label }: { children: ComponentChildren; label: string }) {
  return (
    <fieldset aria-label={label} className='outliner-toolbar-group'>
      {children}
    </fieldset>
  );
}

function adjacentVisibleBlock(
  id: string,
  blocks: readonly OutlinerBlock[],
  direction: -1 | 1
): OutlinerBlock | undefined {
  const visible: OutlinerBlock[] = [];
  const visit = (nodes: readonly OutlinerBlock[]) => {
    for (const node of nodes) {
      visible.push(node);
      if (!node.collapsed) visit(node.children);
    }
  };
  visit(blocks);
  const index = visible.findIndex((node) => node.id === id);
  return index >= 0 ? visible[index + direction] : undefined;
}

function flattenAllBlockIds(blocks: readonly OutlinerBlock[]): string[] {
  const ids: string[] = [];
  const visit = (nodes: readonly OutlinerBlock[]) => {
    for (const node of nodes) {
      ids.push(node.id);
      visit(node.children);
    }
  };
  visit(blocks);
  return ids;
}

function nextSelectedIds(
  current: ReadonlySet<string>,
  id: string,
  range: boolean,
  anchorId: string | undefined,
  visibleBlocks: readonly OutlinerBlock[]
): Set<string> {
  const next = new Set(current);
  if (range && anchorId) {
    const selectedRange = selectVisibleBlockRange(visibleBlocks, anchorId, id);
    if (selectedRange.length) {
      for (const selectedId of selectedRange) next.add(selectedId);
      return next;
    }
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function resizeInput(input: HTMLTextAreaElement) {
  input.style.height = '0';
  input.style.height = `${input.scrollHeight}px`;
}

function formatDateInputValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
