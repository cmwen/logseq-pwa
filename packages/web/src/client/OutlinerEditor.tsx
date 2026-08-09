import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  addSiblingBlock,
  type BlockMutation,
  canIndent,
  canMove,
  canOutdent,
  createBlock,
  deleteBlock,
  dropBlock,
  findBlock,
  focusBlockTree,
  indentBlock,
  mergeBlockBackward,
  moveBlock,
  type OutlinerBlock,
  outdentBlock,
  splitBlock,
  toggleBlockCollapsed,
  updateBlockContent,
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
  readOnly: boolean;
  onActivate: (id: string) => void;
  onInput: (id: string, content: string) => void;
  onKeyDown: (event: KeyboardEvent, block: OutlinerBlock) => void;
  onAction: (action: BlockAction, id: string) => void;
  onMenu: (id: string) => void;
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
  const [focusRequest, setFocusRequest] = useState<FocusRequest>();
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
  };

  const undo = () => {
    const previous = past.current.at(-1);
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [currentBlocks.current, ...future.current].slice(0, 100);
    commit(previous, activeId ? { id: activeId } : undefined, false);
  };

  const redo = () => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current.slice(-99), currentBlocks.current];
    commit(next, activeId ? { id: activeId } : undefined, false);
  };

  const handleInput = (id: string, content: string) => {
    const next = updateBlockContent(currentBlocks.current, id, content);
    commit(next);
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keyboard commands are kept together so their precedence is explicit.
  const handleKeyDown = (event: KeyboardEvent, block: OutlinerBlock) => {
    if (readOnly) return;
    const input = event.currentTarget as HTMLTextAreaElement;
    const command = event.metaKey || event.ctrlKey;

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
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      applyMutation(moveBlock(currentBlocks.current, block.id, event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      applyMutation(
        event.shiftKey
          ? outdentBlock(currentBlocks.current, block.id)
          : indentBlock(currentBlocks.current, block.id)
      );
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const start = input.selectionStart ?? block.content.length;
      const end = input.selectionEnd ?? start;
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
    if (action === 'indent') applyMutation(indentBlock(current, id));
    if (action === 'outdent') applyMutation(outdentBlock(current, id));
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
          onMenu={(id) => setMenuId((current) => (current === id ? undefined : id))}
          readOnly={readOnly}
          registerInput={registerInput}
          onDrop={handleDrop}
          onDragState={setDraggedId}
        />
      </div>

      {!readOnly && active && (
        <div aria-label='Block commands' className='outliner-mobile-toolbar' role='toolbar'>
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
  readOnly,
  onActivate,
  onInput,
  onKeyDown,
  onAction,
  onMenu,
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
              className={`outliner-row ${active ? 'outliner-row-active' : ''} ${draggedId === block.id ? 'outliner-row-dragging' : ''}`.trim()}
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
                className='outliner-input'
                onFocus={() => onActivate(block.id)}
                onInput={(event) => {
                  resizeInput(event.currentTarget);
                  onInput(block.id, event.currentTarget.value);
                }}
                onKeyDown={(event) => onKeyDown(event, block)}
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
                  onMenu={onMenu}
                  readOnly={readOnly}
                  registerInput={registerInput}
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

function resizeInput(input: HTMLTextAreaElement) {
  input.style.height = '0';
  input.style.height = `${input.scrollHeight}px`;
}
