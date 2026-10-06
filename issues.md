# Scriptwriter Implementation Plan

Review date: 2026-10-05
Implementation status: complete

## Outcomes and decisions

- `script.json` remains the typed, durable storage format.
- While the editor is open, its visible CodeMirror text and explicit element-type `StateField` are the screenplay source of truth.
- Element types are never encoded in text and never inferred from text shape.
- `INT.`, `EXT.`, `INT./EXT.`, `EXT./INT.`, `I/E.`, and every other prefix are ordinary content. Typing text never changes an element type.
- A scene heading is created only by an explicit format choice or an editing transition such as Return from an Act. Its text is opaque, and scene CSV uses the complete heading as Location and includes its derived script page.
- Pagination, page starts, outline rows, and scene rows are derived once per immutable document revision and shared by consumers.
- Saves are atomic, edits made during an in-flight save are drained, and a close request waits for the latest revision.
- The native bridge owns the active script root and user-selected export destinations; the renderer cannot provide arbitrary filesystem paths.
- PDF export embeds a Unicode-capable monospaced TrueType font. CSV export neutralizes spreadsheet formulas.

## Implemented architecture

```text
                    +--------------------+
                    |   ScriptSession    |
                    | header, revision,  |
                    | save state, errors |
                    +----------+---------+
                               |
                    +----------v---------+
                    | CodeMirror state   |
                    | visible text plus  |
                    | element-type field |
                    +----------+---------+
                               | immutable snapshot
                    +----------v---------+
                    | Derived document   |
                    | pages / outline /  |
                    | scenes / positions |
                    +-----+---------+----+
                          |         |
                    +-----v---+ +---v------------+
                    | PDF/CSV | | script storage |
                    +---------+ +----------------+
```

### Domain

`src/domain/` owns element types, labels, Return and Tab transitions, blank-line rules, visible editor documents, and immutable positioned snapshots. It has no browser, CodeMirror, Tauri, or filesystem dependencies.

### Editor adapter

`src/editor/adapter.ts` associates each logical element line with an explicit type in CodeMirror state. Structural edits update text and type metadata in one transaction. The same effects participate in undo and redo. Structured browser clipboard data preserves types; multiline plain text defaults to Action without classifying its content.

### Projections

`src/projections/derived.ts` caches pagination, page starts, outline rows, and scene rows by snapshot identity. Cursor-only transactions reuse that result. Character and transition completion consume typed snapshots and never complete scene prefixes.

### Application session

`src/application/session.ts` owns loading, switching, header state, revisions, autosave serialization, retryable errors, close flushing, and export coordination. `src/main/main.ts` now wires DOM intent to the editor and session.

### Infrastructure

`src-tauri/src/lib.rs` keeps the canonical active root in native state. It exposes load-active, choose, save-active, and save-dialog export operations. `script.json` is written to a synced temporary file in its own directory and atomically renamed. Symbolic-link destinations are rejected. The unused native clipboard capability and package were removed.

## Issue plan and disposition

### 1. Recent edits could be lost or corrupt `script.json` — High

Implemented:

- revision and successfully-saved-revision tracking;
- serialized autosave that drains newer edits before completing;
- a close-request flush that keeps the window open on failure;
- same-directory temporary writes, file sync, atomic rename, and directory sync;
- tests proving a simulated commit failure preserves the earlier valid file.

### 2. Native commands allowed arbitrary filesystem access — Medium

Implemented:

- removed renderer-supplied read/write path commands;
- native ownership of the canonical active script directory;
- script-specific load and save commands;
- native folder and export dialogs;
- path revalidation and symbolic-link rejection;
- removal of unused renderer dialog and clipboard permissions.

### 3. PDF export corrupted non-ASCII text — Medium

Implemented:

- `pdf-lib` with an embedded DejaVu Sans Mono TrueType font;
- emitted-glyph width measurement for centering and right alignment;
- correct generated Unicode maps;
- explicit failure for unsupported characters instead of substitution;
- PDF.js integration tests covering curly punctuation, accents, Greek, and Cyrillic.

### 4. The editor encoded types inside screenplay text — Medium

Implemented:

- visible text plus an explicit type `StateField`;
- direct `script.json` element initialization and serialization;
- type-aware Return, Tab, Shift-Tab, Format, insert, delete, undo, redo, copy, and paste;
- exact round-tripping for leading punctuation, zero-width characters, and arbitrary Unicode;
- complete removal of the old parser, hidden characters, shape classification, and automatic scene/act promotion;
- opaque scene-heading text and no prefix/location/time completion.

### 5. Scene CSV permitted spreadsheet formulas — Medium

Implemented:

- neutralization of cells beginning with `=`, `+`, `-`, or `@`, including after leading whitespace or controls;
- CSV quoting after neutralization;
- complete opaque scene headings in the Location column;
- page numbers from the shared pagination projection;
- tests for formulas, controls, commas, quotes, and newlines.

### 6. Parsing and pagination were repeated — Low

Implemented:

- stable immutable document snapshots per editor state;
- one cached derived snapshot per document identity;
- shared pages, page starts, outline rows, and scene rows;
- an instrumented cache test and an editor test proving cursor movement causes no new derivation.

## Dependency audit result

- `npm audit` reports zero vulnerabilities.
- `cargo audit` reports zero vulnerability findings. It reports `RUSTSEC-2024-0370`
  (`proc-macro-error` is unmaintained) and `RUSTSEC-2024-0429` (`glib` iterator
  unsoundness) as warnings in Tauri's Linux WebKitGTK dependency graph.
- Neither crate is present in the current macOS target graph. They are indirect Tauri
  dependencies rather than application dependencies, so there is no safe project-level
  upgrade that removes them while remaining on the current stable Tauri release.

## Verification checklist

- TypeScript unit and editor integration tests
- production TypeScript/Vite build
- Rust unit tests, including atomic-failure and symbolic-link cases
- `cargo fmt --check`
- Clippy with warnings denied
- npm dependency audit
- RustSec audit
- shell syntax check for `sw`
- repository search for removed legacy modules, hidden-character logic, and generic filesystem commands
