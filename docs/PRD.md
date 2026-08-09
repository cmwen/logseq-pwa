# PRD — Journal-First Personal Knowledge Workspace MVP

## 1. Document Status

**Status:** Draft
**Product stage:** MVP
**Primary platforms:** Desktop Web/PWA, Android PWA
**Primary user:** Single-user personal workspace
**Core principle:** Local-first, journal-first, block-first

---

# 2. Product Summary

This product is a local-first personal knowledge workspace designed around the way the user already thinks and writes:

> Capture quickly into a daily journal, structure thoughts naturally as nested blocks, and reliably retrieve them later.

The MVP is not intended to reproduce Logseq as a product.

It is intended to replace the subset of Logseq that is essential to the user’s daily workflow.

The defining interaction model is the **outliner**.

A document is not primarily edited as one large Markdown textarea. Instead, it is experienced as a hierarchy of independently editable blocks.

Example:

```text
- Research personal context systems
    - Memory should retain provenance
    - AI should not automatically remember everything
        - Suggest memories
        - Human confirms
    - Local-first data ownership is essential

- Pick up children after school
```

Block editing is a P0 requirement.

---

# 3. Problem Statement

The existing knowledge system contains several years of journals, research notes, personal memories, project information and imported material.

Analysis of the existing workspace shows that the dominant behaviour is:

1. Open the daily journal.
2. Capture information quickly.
3. Structure information using nested blocks.
4. Connect blocks to pages using references and tags.
5. Add lightweight properties where useful.
6. Find information later through search, backlinks and structured views.

The existing application provides many features the user does not need.

The replacement should therefore optimize for the actual workflow rather than recreate the full existing application.

---

# 4. Product Goal

Create a personal knowledge workspace that feels natural enough to replace the user’s everyday Logseq interaction.

The MVP succeeds if the user can:

* use it as the primary daily journal;
* capture thoughts naturally on mobile and desktop;
* think using nested blocks rather than flat documents;
* find previously captured material quickly;
* navigate connected pages and references;
* continue owning all underlying data.

The primary validation question is:

> Can I use this for my normal daily knowledge workflow without wanting to return to Logseq?

---

# 5. Product Principles

## 5.1 Block-first

The block is the primary editing unit.

Every journal or page contains an ordered hierarchy of blocks.

Users must be able to manipulate blocks naturally without thinking about Markdown syntax.

## 5.2 Journal-first

Today’s journal is the primary landing surface and capture inbox.

A new journal is implicitly available each day.

## 5.3 Capture before organization

Users should not need to decide where something belongs before writing it down.

Organization can happen afterwards.

## 5.4 Local-first

The canonical workspace is stored in user-controlled local files.

The application must remain useful without a cloud account or internet connection.

## 5.5 Portable data

Content must remain readable outside the application.

The application may maintain local indexes and caches, but those must not be the only representation of user knowledge.

## 5.6 Retrieval over perfect organization

Search, references and backlinks should make imperfectly organized information recoverable.

---

# 6. MVP Scope

The MVP includes:

1. Daily journals
2. Nested block outliner
3. Quick capture
4. Pages
5. Page references
6. Tags
7. Backlinks
8. Full-text block search
9. Basic block properties
10. Desktop and mobile responsive experience
11. Local workspace persistence
12. Basic migration/import from existing content

The MVP explicitly does not include:

* AI assistant
* semantic search
* embeddings
* query/table builder
* advanced templates
* whiteboards
* task management system
* scheduled reminders
* calendar integration
* plugin ecosystem
* collaboration
* real-time multi-device editing
* CRDT
* cloud synchronization service
* SRS/flashcards
* advanced PDF workflows
* Logseq compatibility as a permanent requirement

---

# 7. Core Information Model

The user-facing hierarchy is:

```text
Workspace
  ├── Journal Pages
  ├── Normal Pages
  │
  └── Blocks
       ├── Child Blocks
       ├── Properties
       ├── Page References
       └── Tags
```

A journal is a special page associated with a date.

A page is a named container for blocks.

A block is:

* independently editable;
* ordered relative to siblings;
* optionally nested under another block;
* linkable;
* searchable;
* capable of containing metadata.

---

# 8. Block Outliner Requirements

## 8.1 Block Editing

Each block must be independently editable.

Selecting a block places the editing caret inside that block only.

Editing one block must not require loading the page into a raw Markdown editor.

## 8.2 Create Block

Pressing `Enter` creates a new sibling block below the current block.

If the caret is in the middle of a block, `Enter` splits the block at the caret.

Example:

Before:

```text
- Personal context is useful because it preserves reasoning
```

Caret after `useful`.

After:

```text
- Personal context is useful
- because it preserves reasoning
```

## 8.3 Indentation

Desktop:

* `Tab` → indent current block beneath previous sibling.
* `Shift + Tab` → outdent block.

Mobile must expose equivalent controls without requiring a hardware keyboard.

## 8.4 Block hierarchy

Moving a parent block must move all descendants.

Example:

```text
- Parent
    - Child A
    - Child B
        - Grandchild
```

Moving `Parent` moves the complete subtree.

## 8.5 Delete behaviour

Deleting an empty block should behave naturally:

* merge with previous block where appropriate;
* remove the block without corrupting children;
* preserve undo capability.

Deleting a parent containing children must never silently delete the subtree without explicit intent.

## 8.6 Reordering

Blocks can be reordered.

Desktop:

* drag-and-drop;
* keyboard shortcuts may be added.

Mobile:

* long press or block menu.

Dragging a parent carries its descendants.

## 8.7 Collapse and expand

Blocks with children may be collapsed.

Collapse state is UI state and must not change block content.

## 8.8 Block focus

A block may be opened in focused mode.

Focused mode displays:

* selected block;
* descendants;
* breadcrumb path back to the page.

This is not required for the earliest build but should be supported by the underlying architecture.

## 8.9 Block selection

The editor should eventually support multi-block selection.

For MVP, basic selection is sufficient if the architecture does not prevent future multi-block actions.

## 8.10 Undo and redo

All destructive block operations must support undo:

* edit;
* split;
* merge;
* indent;
* outdent;
* move;
* delete.

---

# 9. Mobile Outliner UX

Mobile is a first-class environment.

The editor must not simply shrink the desktop UI.

## 9.1 Touch targets

Each block should expose a touch-friendly block handle.

The handle can open a contextual menu with:

* indent;
* outdent;
* move;
* delete;
* copy link;
* collapse.

## 9.2 Keyboard behaviour

The mobile software keyboard must allow natural multi-block writing.

A toolbar above the keyboard should provide frequently used commands:

```text
← Outdent   → Indent   + Block   ⋯
```

## 9.3 Fast capture

Opening the application should make it possible to create a journal block with minimal navigation.

Desired flow:

```text
Launch
→ Today
→ Tap capture
→ Type
→ Done
```

## 9.4 Mobile reading

When not editing, block chrome should disappear or become visually minimal.

The journal should remain comfortable to read as a document.

---

# 10. Desktop Outliner UX

Desktop should emphasize keyboard interaction.

Required shortcuts:

```text
Enter             New/split block
Tab               Indent
Shift + Tab       Outdent
Backspace         Merge/remove where appropriate
Cmd/Ctrl + Z      Undo
Cmd/Ctrl + Shift+Z Redo
Cmd/Ctrl + K      Global search
```

Future shortcuts may include:

```text
Alt + ↑ / ↓       Move block
Cmd/Ctrl + ↑      Focus parent
```

Mouse interaction should remain optional for normal writing.

---

# 11. Daily Journal

The application opens to Today by default.

Each date corresponds to one journal page.

Example:

```text
2026-08-09

- Thinking about the new knowledge workspace
    - Block editing is essential
    - Search should operate on blocks

- Read about agent memory
```

Requirements:

* automatically resolve today’s journal;
* create it lazily on first write;
* navigate previous and next journal;
* allow references to dates;
* search journal content identically to normal pages.

---

# 12. Quick Capture

Quick Capture creates a new block in today’s journal.

It must work from:

* Today page;
* global capture action;
* mobile navigation;
* desktop keyboard shortcut.

Optional timestamp:

```text
- 07:45 Need to rethink the outliner architecture
```

Capture must never require:

* page selection;
* tags;
* properties;
* category;
* project selection.

---

# 13. Pages and References

Users may create named pages.

Syntax such as:

```text
[[Personal Context]]
```

creates or references a page.

Clicking the reference opens that page.

The system maintains backlinks automatically.

Page identity must be independent from the physical filename.

Namespaced names must be supported:

```text
Project/Now/Recall
References/AI
External Memory/Nathan
```

The UI should treat `/` as semantic hierarchy without requiring corresponding physical folders.

---

# 14. Tags

Tags behave as lightweight references.

Examples:

```text
#ai
#research
#react
```

Search and matching must be case-insensitive.

The data model must permit aliases and normalization later.

For example:

```text
AI
ai
#AI
```

may eventually resolve to the same canonical concept without rewriting original content automatically.

---

# 15. Properties

Blocks may contain lightweight arbitrary key-value metadata.

Example:

```text
- Morning run
    exercise-type:: Running
    duration:: 35
    distance:: 5.2
```

MVP requirements:

* detect `key:: value`;
* associate property with the containing block;
* index key and value;
* allow search by property text.

MVP does not need a property schema editor or database table UI.

---

# 16. Search

Search operates primarily over blocks.

Searching:

```text
local LLM
```

should return matching blocks with enough surrounding hierarchy to understand their context.

Result:

```text
2026-07-28

Research AI workspace
  › Local LLM quality is insufficient for primary reasoning
```

Search covers:

* block content;
* page names;
* references;
* tags;
* properties.

Search result actions:

* open block in page context;
* open containing page;
* preserve search query when navigating back.

---

# 17. Backlinks

Each page displays references pointing to it.

A backlink result should show:

* source page;
* matching block;
* parent block context;
* journal date where applicable.

Backlinks are derived indexes and do not need to be written into the canonical file.

---

# 18. Persistence

Canonical content must remain locally stored and portable.

Preferred persistence model:

```text
Human-readable workspace files
        ↓
Parser
        ↓
Disposable local index
```

The local index may include:

* pages;
* blocks;
* hierarchy;
* properties;
* references;
* tags;
* full-text index.

The index must be rebuildable from canonical workspace data.

---

# 19. Migration

MVP should include a one-time importer for the existing personal graph.

Migration should preserve the important behaviours, not permanent compatibility.

Initial migration should support:

* journals;
* pages;
* nested blocks;
* page references;
* tags;
* basic properties;
* namespaces;
* attachments where straightforward.

Unsupported syntax should be preserved as text rather than discarded.

Migration should produce a report covering:

* converted files;
* unsupported constructs;
* malformed references;
* duplicated page/tag names;
* conflicting properties.

---

# 20. Performance Targets

Expected initial dataset:

* approximately 1,000+ pages/journals;
* approximately 25,000 blocks;
* hundreds of attachments.

Targets:

* Today usable quickly after launch;
* editing a block feels immediate;
* indent/outdent/reorder feels immediate;
* common search results appear within roughly 200 ms after indexing;
* only changed files/pages should require reparsing where practical.

---

# 21. Reliability Requirements

Block editing must prioritize data safety.

The product must:

* never silently discard typed content;
* autosave frequently;
* recover unsaved block drafts after accidental navigation;
* detect external changes before overwriting;
* support undo for block operations;
* use atomic persistence where supported.

---

# 22. MVP Success Criteria

The MVP is successful if, during a real usage trial:

1. The user chooses it instead of Logseq for daily journal capture.
2. Nested block editing feels at least as natural as the current workflow.
3. The user can comfortably capture from both desktop and mobile.
4. The user can find existing knowledge through search and backlinks.
5. Existing page references remain useful after migration.
6. Normal use does not require opening raw Markdown files.
7. The underlying content remains readable and owned by the user.
8. No data is lost during everyday block operations.

The strongest qualitative test is:

> Does the outliner disappear as an interface and simply feel like the natural way to think?

---

# 23. Explicit MVP Priority

If trade-offs are required, prioritize in this order:

1. Block editing quality
2. Data integrity
3. Daily journal capture
4. Mobile capture quality
5. Search
6. References/backlinks
7. Properties
8. Visual polish

A beautiful UI with mediocre block editing is considered a failed MVP.
