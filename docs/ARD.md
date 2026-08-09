# ADR-001 — Use a Block-Based Outliner as the Core Editing and Content Model

## Status

**Accepted**

## Date

2026-08-09

## Decision Owners

Project owner / primary user

---

# Context

The product is intended to replace the subset of an existing personal knowledge system that is genuinely useful in daily life.

Analysis of approximately three years of real usage shows:

* around 23,000 Markdown blocks;
* approximately 7,900 journal blocks;
* roughly 78% of journal content is nested;
* daily journals are the primary capture surface;
* thoughts are commonly represented as a parent idea followed by nested supporting details;
* page references, tags and properties are attached naturally within this block structure.

The user has explicitly identified outliner-style editing as a must-have interaction:

> Block editing feels natural and must be present in the first MVP.

A conventional document editor would treat a page as one continuous text value.

That would simplify implementation but would fundamentally change the writing and thinking experience.

The product therefore needs to decide whether blocks are:

1. merely a UI illusion over a document textarea; or
2. first-class entities in the application's editing and indexing model.

---

# Decision

The product will use a **block-based hierarchical outliner as its primary editing model**.

A page will be represented as an ordered tree of blocks.

Each block will have a stable application identity and structural relationship to other blocks.

Conceptually:

```text
Page
 ├── Block A
 │    ├── Block A.1
 │    └── Block A.2
 │         └── Block A.2.1
 └── Block B
```

The block—not the complete document—is the fundamental unit for:

* editing;
* hierarchy;
* selection;
* movement;
* search results;
* references;
* future AI provenance.

The page remains the unit of navigation and persistence grouping.

---

# Rationale

## 1. It matches proven user behaviour

This decision is based on observed usage rather than preference speculation.

The existing journal corpus is predominantly nested.

A flat Markdown editor would force the user to manually manipulate indentation and document structure that the current outliner handles naturally.

## 2. Block structure is part of thinking

The hierarchy often represents semantic relationships:

```text
- Main idea
    - Evidence
    - Consequence
        - Further question
```

Flattening this into document text loses an important interaction layer.

## 3. It improves mobile capture

On mobile, editing an isolated block is easier than positioning the cursor within a large Markdown document.

Block actions can also be exposed through touch controls:

* indent;
* outdent;
* move;
* collapse;
* delete.

## 4. It improves retrieval

Search results can point directly to the relevant thought rather than only to the containing file.

Example:

```text
Search result
→ block
→ ancestors
→ page/journal
```

This provides substantially better context than file-level search.

## 5. It supports future provenance

Future Personal Context and AI functionality may derive:

* decisions;
* learnings;
* people facts;
* project state;

from individual pieces of content.

Stable block identities allow a derived memory to reference its evidence:

```text
Memory
  source_block_id: b_12873
```

This enables memory with provenance.

---

# Data Model Decision

The application runtime will maintain a structure similar to:

```text
Page
----
id
name
type
created_at
updated_at

Block
-----
id
page_id
parent_id
position
content
collapsed
created_at
updated_at
```

Additional derived entities may include:

```text
Property
--------
block_id
key
value

Reference
---------
source_block_id
target_page_id

Tag
---
block_id
canonical_tag
```

`parent_id = null` identifies a root block.

Sibling ordering must be represented explicitly.

The implementation may use fractional indexing, sortable position keys or another ordering scheme as long as:

* inserting between blocks is efficient;
* moving subtrees is reliable;
* persistence does not unnecessarily rewrite the entire workspace.

---

# Stable Block IDs

Blocks should have stable IDs within the application's logical model.

However, not every visible block must necessarily expose its ID in Markdown.

The implementation should avoid polluting human-readable content unless IDs are required for durable external references.

Possible strategies include:

### Option A — IDs in canonical Markdown

```text
id:: 01JABC...
```

Advantages:

* completely portable;
* stable across index rebuilds.

Disadvantages:

* visual noise;
* modifies many files;
* couples Markdown syntax to implementation.

### Option B — IDs in page metadata/sidecar mapping

```text
.page-meta/
  page-id.json
```

Advantages:

* Markdown stays cleaner.

Disadvantages:

* metadata must remain synchronized.

### Option C — Deterministic/recoverable IDs where possible

Generate identity from structural/content information and persist only IDs that are externally referenced.

Advantages:

* minimal file pollution.

Disadvantages:

* identity becomes complicated after edits.

**MVP decision:** block IDs are required in the internal model, but the exact long-term persistence strategy remains an implementation sub-decision.

The MVP architecture must not assume block identity can be discarded.

---

# Editing Semantics

The following semantics are part of the architecture, not optional UI enhancements.

## Enter

Creates or splits a block.

## Backspace

May merge with the previous block when at the beginning of a block.

## Indent

Changes the parent relationship.

## Outdent

Moves the block one hierarchy level upward.

## Move

Reorders a block and its complete subtree.

## Delete

Deletes the intended block/subtree with undo protection.

## Collapse

Changes presentation state without deleting or rewriting descendants.

These operations should be implemented as structured block operations rather than arbitrary string transformations over an entire Markdown document.

---

# Persistence Decision

The outliner model does **not** imply that a database becomes the canonical source of user knowledge.

The intended architecture remains:

```text
Portable canonical representation
            ↓
       Parse / load
            ↓
    Block runtime model
            ↓
      Local SQLite index
```

SQLite may store:

* parsed block structure;
* search index;
* backlinks;
* properties;
* references;
* cached metadata.

The database must be rebuildable from canonical content unless a later ADR explicitly changes this rule.

---

# Markdown Representation

The canonical textual format must preserve hierarchy.

Example:

```markdown
- Research memory systems
  - Preserve source provenance
  - Human confirmation is required
    - Don't automatically remember everything

- Review project architecture
```

Properties may remain readable:

```markdown
- Morning run
  exercise-type:: Running
  duration:: 35
```

Page references may remain readable:

```markdown
- Continue [[Project/Now/Recall]]
```

The application is free to define a small Markdown dialect where necessary.

Permanent Logseq syntax compatibility is not a requirement.

---

# Rendering Architecture

The editor should not be implemented as one giant editable Markdown textarea.

Preferred conceptual structure:

```text
PageEditor
  └── BlockTree
       ├── BlockEditor
       ├── BlockEditor
       │    └── BlockTree
       │         └── BlockEditor
       └── BlockEditor
```

Virtualisation may later be required for very large pages.

Block components should have stable keys based on block identity rather than array position.

---

# Search Architecture

Search will index blocks independently.

A search record should retain:

```text
block_id
page_id
content
parent_id
page_name
journal_date
properties
references
tags
```

Search results may reconstruct ancestor context.

This is preferred over indexing only complete page text.

---

# Mobile Consequences

Because block editing is core, the mobile interface must provide touch equivalents for structural commands.

Minimum command surface:

* indent;
* outdent;
* add sibling;
* move;
* delete;
* collapse.

A mobile implementation that only exposes a full-document textarea does not satisfy this ADR.

---

# Alternatives Considered

## Alternative 1 — Plain Markdown document editor

A page is loaded into CodeMirror or textarea as one document.

### Advantages

* easiest implementation;
* Markdown representation maps directly to storage;
* mature editor libraries available.

### Rejected because

* does not match user behaviour;
* mobile nested editing becomes cumbersome;
* hierarchy manipulation requires Markdown syntax awareness;
* search cannot naturally target thought-level units;
* future provenance is weaker.

---

## Alternative 2 — WYSIWYG document editor with list indentation

Use ProseMirror/Lexical-style rich document editing.

### Advantages

* polished document editing ecosystem;
* rich formatting;
* structured AST.

### Rejected as the default because

The product is fundamentally an outliner rather than a word processor.

A rich document model may introduce unnecessary complexity around paragraphs, marks and layout.

Such libraries may still be evaluated as implementation engines if they can faithfully support the required block semantics.

---

## Alternative 3 — Database-first blocks with no portable textual representation

Store pages and blocks exclusively in SQLite.

### Advantages

* simple structural queries;
* stable IDs;
* transactional mutations;
* easier indexing.

### Rejected because

It violates the local-first portability goal.

The user should not require this application to inspect or recover their knowledge.

---

## Alternative 4 — Reproduce Logseq's complete block model

Clone Logseq behaviour and syntax.

### Advantages

* migration simplicity;
* familiar semantics.

### Rejected because

The goal is not Logseq compatibility.

Copying the full model would introduce features and technical constraints that the user does not require.

---

# Consequences

## Positive

* Editing matches existing mental habits.
* Journaling remains natural.
* Mobile capture improves.
* Search becomes granular.
* Backlinks can show exact thought context.
* Properties map cleanly to specific blocks.
* Future AI-derived memories can cite exact evidence.
* Migration from existing nested content is conceptually straightforward.

## Negative

* Editor implementation is substantially harder than a Markdown textarea.
* Cursor and keyboard behaviour require careful design.
* Drag-and-drop hierarchy introduces complexity.
* Undo/redo must cover structural operations.
* Persistence must reconcile tree operations with human-readable files.
* External file edits require reparsing and reconciliation.
* Mobile interaction needs custom block controls.

These costs are accepted because outliner behaviour is a defining product requirement rather than optional polish.

---

# Risks

## Risk 1 — Building the editor consumes most MVP effort

Mitigation:

Limit formatting features aggressively.

Prioritize:

```text
text
nesting
references
tags
properties
```

Do not initially build a rich-text editor.

## Risk 2 — Markdown serialization creates noisy diffs

Mitigation:

Ensure block operations only rewrite the minimum necessary content where practical.

Add serialization tests using real migrated journals.

## Risk 3 — External edits invalidate block identity

Mitigation:

Use a reconciliation layer and design stable identity explicitly.

Do not rely solely on line numbers.

## Risk 4 — Mobile block UX feels cumbersome

Mitigation:

Prototype mobile block interaction before building secondary features.

Block editing quality is an MVP validation target.

---

# Validation

This ADR should be considered validated when a prototype demonstrates all of the following on both desktop and Android:

1. Rapid sequential block entry.
2. Split and merge.
3. Three or more nesting levels.
4. Indent and outdent.
5. Moving a subtree.
6. Collapse and expand.
7. Autosave.
8. Undo/redo.
9. Search returning a specific block.
10. Opening a search result within its page hierarchy.

The strongest acceptance test is qualitative:

> The user should stop thinking about “editing blocks” and simply use the hierarchy naturally while thinking.

---

# Decision Summary

The product is not a Markdown editor with optional outlines.

It is:

> **An outliner whose durable representation remains portable and human-readable.**

This distinction is foundational and should guide future decisions about the editor, persistence layer, search architecture, migration and AI/context capabilities.
