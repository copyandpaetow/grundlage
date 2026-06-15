# Changelog

Landed work and decided experiments. Open work lives in [`docs/plans/TODO.md`](docs/plans/TODO.md);
durable rationale in `CONVENTIONS.md` and `docs/adr/`.

Pre-1.0: engineering changes are grouped by area, not version — only tagged releases carry numbers.

## [0.6.0]

- Reworked the render engine for clarity (`2b9130c`); added the performance bench suite (`e7323b1`).
- Renamed `loadData` → `load`; added `llms.txt`; refreshed the README.

## Landed engineering (pre-1.0)

### Parser

- **Document-free parser (Part A).** `parse()` touches no DOM: pooled `ParserState` struct +
  context-first free functions; returns a string seed (`fragment: null`), materialized lazily on
  first `setup()`; root-template detection moved into parse state. ADR-0009 (pooled struct),
  ADR-0010 (document-free).
- **Centralized per-element scope reset** (`resetElementScope()`) — one place drains the scratch
  buffers and clears `currentTagName`/`selfClosing`.
- **Attribute type bits classified at parse time** — `ATTRIBUTE_NAME_KIND` + `eventName` on
  `AttributeBinding`, dispatched via `switch` instead of a per-write charCode cascade.

### Attributes

- **Loud unknown `on*` handlers** (`warnIfDeadNativeHandler`, error contract / ADR-0002).
- **Guarded `clearHostAttributes` cast** — ATTR-type check before the shape switch.
- **Name-only (object) attribute diffing** — stable spread entries skipped; object spread −24% to
  −87%. Array path left undiffed (membership diff measured +22%, falls back to clear+apply).
- **Multi-value attr listener leak** — invariant confirmed (string-only path), documented, no code
  change.
- **Rule 8 — per-shape `{ apply, remove }` units** + a `handlerForShape` jump table over the dense
  `ATTRIBUTE_SHAPE` enum, replacing the twin switches.

### Content

- **Unified `EMPTY_EXPRESSIONS` sentinel** in its own leaf module (kept outside the
  template-html ↔ content ↔ attribute import cycle).
- First-render branch reads the sentinel explicitly; `EXPANDABLE` stores its slot in `values[0]`
  like every other shape; 5 `.length` first-render probes replaced with sentinel identity compares.
- **Rule 13 — `renderRoot`** unifies the CSR/SSR root callbacks, freeing the `renderTemplate` name
  for the content helper.

### Tags

- **Skip rebuild when the tag name is unchanged** (`newTag === element.localName`) — setup hit-path
  −42%; also preserves focus/selection on same-name re-render.

### Templates

- **Dropped `bindingIndex` from `TagBinding`** — position is the universal model.
- **`HTMLTemplate` → free functions**, type kept as a **data-only class** discriminated by
  `instanceof` (a struct brand measured ~3.5× slower on the hot `hashValue` miss). Provisional
  Rule 3 exception in `CONVENTIONS.md`; revisit when `css\`\`` lands.

### Core

- **`update()` spans the whole async render** (ADR-0003) — early-resolve, coalescing, mid-flight
  reflush, error-resolves, supersession; driver fires a one-shot `onSettle` at each terminal.

### Process

- Committed `CONVENTIONS.md`; opened ADRs for the deferred tradeoffs.

## Measured and rejected

- **`VALUE_KIND` content-kind classification** — a per-template `Uint8Array` on the constructor
  regressed construction up to +97% / lists +5–14%; the dispatch saving came back within noise.
  Rejected. (The attribute half *did* land, at parse time.)
- **Committed-state change detection** (2026-06-15) — built out and A/B'd head-to-head against the
  hash engine: tie on every idle path, regression on bulk change (list 1000 all-labels 2.1×, nested
  5×5 1.77×, partial-wide 1.8×). Did not earn its ~+130 LOC / per-instance `committed` array.
  Rejected; reverted to the hash engine. Independent wins kept — see `TODO.md`.
</content>
</invoke>
