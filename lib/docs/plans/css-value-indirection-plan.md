# Plan: fast dynamic CSS via custom-property value-indirection

Status: proposed. Scope: library-side, `<style>` raw content **and** the inline `style`
attribute, on one shared pathway.

## Problem

A `<style>` with any dynamic hole is a single `RAW_CONTENT` binding. On every change the
updater does `element.textContent = bindingToString(...)` (`rendering/raw-content.ts:8`),
which re-serializes the whole sheet and forces the browser to **reparse all of it**. In the
cube editor a per-frame hole (`--carrier-live`) reparses ~150 lines every frame: 20–30fps
vs. 90–100fps for camera movement.

Empirically confirmed (cube spikes):

- Baseline (renegade direct `setProperty`, no library channel): 90–100fps.
- Channel + re-serialized `<style>`: 55–65fps.
- Channel + **static** `<style>` + `setProperty`: 100–110fps.

Conclusion: the render channel is free (microtask batching makes it net-positive); the
entire penalty is the raw-content reparse. The inline `style` attribute has the same shape
of bug at smaller scale — `applyAttributeBinding` does `setAttribute("style", String(value))`
(`rendering/attribute.ts:60`), re-tokenizing the whole declaration **and clobbering any
custom property set on that element by another writer**.

## Decision

Keep the sheet/declaration **static** and route every dynamic _value_ through a CSS custom
property updated with `setProperty`. The decision, its rationale, the value-slot scope, and
the rejected alternatives (reparse, rule-index, `adoptedStyleSheets`) are recorded in
**ADR-0008** (`docs/adr/0008-dynamic-css-via-custom-property-value-indirection.md`). The rest
of this document is the implementation plan for that decision.

## The two write mechanisms (one shared core)

The `<style>` tag and the `style` attribute differ only in the write target and whether
indirection is needed:

|                 | `<style>` value hole                                                      | `style=` value hole                       |
| --------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| grammar         | full stylesheet (selectors, at-rules, nesting)                            | flat declaration list                     |
| consumer        | a selector → descendant(s)                                                | the element itself                        |
| write           | `host.style.setProperty("--cN", v)` + `var(--cN)` rewrite in static sheet | `el.style.setProperty(prop, v)` directly  |
| indirection     | **yes** (can't `setProperty` a selector)                                  | **none** (we own the exact element)       |
| whole-hole case | reparse fallback                                                          | owned-keys reconciler (no `setAttribute`) |

Both reduce to one primitive: **diff a binding's declaration groups against the previous
frame and apply `setProperty`/`removeProperty` to a `CSSStyleDeclaration`** (`host.style`
for the tag, `el.style` for the attribute). The tag adapter additionally rewrites the
static sheet to `var(--cN)`; the attribute adapter writes the real property name directly.

The unit of update is a **declaration value group**, not an individual hole:
`transform: rotate(${a}deg) translateX(${x}px)` is one group → one `--cN` → one
`setProperty('--cN', assembled)`. Multiple holes in one value collapse to a single
property write.

**`--cN` is a name, not a counter.** `N` is **not** a per-instance running index. The
property name is deterministic: `--` + a per-template discriminator (`templateHash` in
base36) + the group's ordinal in the plan. Same template ⇒ same names on server and client,
so hydration agrees with zero coordination — no per-instance counter, no `Math.random`
(see `css\`\``commitments #2 and #7). The casual`--cN` used elsewhere in this doc is
shorthand for that scheme.

**Per-group dirty test.** A group is re-assembled and re-`setProperty`'d iff at least one of
its `expressionIndices` changed this flush; unchanged groups are skipped entirely. The
binding's existing dirty bit only gates _entry_ into the updater.

## Architecture / pipeline integration

1. **CSS plan, computed once, riding the existing parse cache.** The HTML parse is already
   memoized per template `strings` identity. During that parse, when a `RAW_CONTENT`
   binding is a `<style>` (or an ATTR binding is `style`), run the CSS declaration analyzer
   over its static string segments + hole positions and attach a `cssPlan` to the binding.
   No separate WeakMap, no per-instance re-parse of the structure. (The browser's
   per-instance parse of the final cssText is separate and unavoidable without
   `adoptedStyleSheets` — but it happens **once at setup**, not per frame.)

2. **The binding stays single; granularity is internal.** Raw content cannot hold comment
   markers (that is _why_ it's raw), so a `<style>` cannot be split into multiple
   DOM-anchored bindings. It remains one `RAW_CONTENT` binding anchored to the `<style>`
   element. Per-group granularity comes from comparing each group's expressions against
   `previousExpressions` _inside_ the updater — `previousExpressions` is live during
   `#flush` (`template-html.ts:147`). No change to the per-binding dirty machinery; the
   existing dirty bit ("some expression in this binding changed") gates entry, the internal
   diff decides which groups re-`setProperty`.

3. **Setup (first render / SSR) writes the static sheet with fallbacks.** Rewrite each
   dynamic value group to `var(--cN, <initial>)` where `<initial>` is the assembled value
   from the first render's expressions, then `setProperty('--cN', <initial>)` on the host.
   - SSR (generator stops at first yield, no client JS): the `var(--cN, <initial>)`
     fallback carries the correct initial values into the static HTML — bare render is
     correct with zero JS.
   - Hydration (CSR over SSR): the `<style>` **already holds** the correct
     `var(--cN, <initial>)` text from the server. Setup must **not** rewrite `textContent`
     in that case — detect the already-populated sheet and only resolve the carrier and
     attach `setProperty`. Rewriting would force exactly the one reparse this plan exists to
     remove. Only the pure-CSR first render (empty `<style>`) writes the sheet text.
   - CSR/hydration: subsequent frames only `setProperty('--cN', newValue)`; the sheet text
     is never touched again.

4. **Fallback path unchanged.** If the plan marks the binding `structural` (any
   selector / descendant property-name / whole-stylesheet hole), the updater keeps doing
   `textContent = bindingToString(...)`. Mixed sheets (some value holes, some structural)
   fall back wholesale in v1 — simplest and always correct; per-group partial fallback is a
   later refinement.

## Coordination with the HTML parser

**The two parsers are not intertwined.** The HTML parser already isolates a `<style>` body
into one `RAW_CONTENT` binding whose `values` is the body _pre-split at every `${}`_
(`parser/html.ts:248`, `completeSpecialContent`). That interleaved
`(staticString | expressionIndex)[]` **is the CSS analyzer's input** — we run a post-pass
over the finished binding, never feeding CSS into the HTML character state machine.

Two distinct parses, kept separate:

|                         | what                                         | when                                                     | cost                                   |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| structural CSS analysis | our analyzer, pure string work, no browser   | once, html-parse time (post-pass), cached on the binding | once ever per call-site                |
| browser cssText parse   | `textContent = …` → browser parses the sheet | once per instance at **setup**                           | unavoidable without adoptedStyleSheets |

The `<style>` element is created **empty** in the fragment; its body lives in
`binding.values` and only reaches the DOM via `textContent` at setup. The bug today is the
browser parse running **every frame**; the fix moves it to once-at-setup. The analyzer
runs inside `parse()` (or lazily memoized on the binding) so it rides the existing
`htmlCache` WeakMap (`parser/html.ts:708`) — computed once per call-site.

**One minimal, additive HTML-parser change:** stamp the `RAW_CONTENT` binding with which
special tag produced it (`style` vs `script` vs `textarea`) so the post-pass only analyzes
`<style>`. No flow change.

## Where reactivity lives

The `cssPlan` is **data hanging off the style binding inside `ParsedHTML`**, not a parallel
cache — so it rides the same per-call-site WeakMap. It holds the static sheet template
(`var(--cN)` slots), the group descriptors (expression-indices → `--cN`, kind
`value | structural`), and the `structural` short-circuit flag. Immutable, computed once.
(`cssPlan` is the one name for this object throughout — there is no separate `ParsedCSS`.)

**Reactivity stays in `HTMLTemplate`; no new reactive class.** It already owns
`currentExpressions`/`previousExpressions`, the dirty bits, and `#flush`. The style binding
is just a binding; its updater reads the _shared_ plan + _per-instance_ expressions and
emits `setProperty`. The `<style>` value-group path holds **no** per-instance state — values
are assembled each flush from `previousExpressions`/`currentExpressions` against the shared
plan. The one exception is the `style=${obj}` reconciler: it **stores the set of property
names it owns** (one `Set<string>` per such binding). Re-deriving the previous key set from
`previousExpressions` each frame would re-parse the prior string / re-iterate the prior
object and allocate a transient Set on a per-frame path — the retained Set is the cheaper
trade (perf vetoes the "zero state" default; see CONVENTIONS preface). The shared apply step
is a pure function `(CSSStyleDeclaration, plan, resolve, previous)`, not a class.

## `css\`\`` — not v1, but v1 must not foreclose it

`css\`\``is **not required for v1**. The`<style>`post-pass covers the primary authored
shape (styles as`<style>`in the html template).`css\`\``earns its place later for
composition:`<style>${shared} .x{…}</style>` where `${shared}`is an opaque string is a
whole-stylesheet hole → fallback today. As a`css\`\``result it carries its own cached`cssPlan`+ its own`--cN`namespace, so the parent **splices the child's static text and
merges its`setProperty`plan** instead of falling back — analogous to nesting an`HTMLTemplate` in content position.

The point of this section is **forward-compatibility**: v1 must be shaped so v2 adds `css\`\``without a rewrite. Below: what`css\`\`` _is_, where it may appear, the v1 commitments that
keep the door open, what v2 adds, and what stays out of scope.

### What `css\`\`` is, and where it may appear

**Invariant: `css\`\`` is a stylesheet** (selectors + declarations + at-rules, scoped via a
`<style>`). That single definition decides every usage position:

| position                  | verdict                  | why                                                                                                                 |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `<style>${style}</style>` | **yes — primary**        | a stylesheet belongs in a `<style>`; the splice/merge case                                                          |
| `${style}` as content     | **maybe — sugar, defer** | coherent: a stylesheet in content = "render a scoped `<style>` here"                                                |
| `style="${style}"`        | **no**                   | the attribute is a flat _declaration list_, not a stylesheet — different grammar; use `style=${obj}`                |
| `class="… ${style}"`      | **no**                   | a stylesheet is not a class name; auto-generating one needs global injection → violates "touch document.head never" |

So: `css\`\``goes where a`<style>`may go (the tag, or — later — content position that
becomes a scoped`<style>`); **never as an attribute value**. Inline declarations are the
object form (`style=${obj}`). The only thing v1 owes here is a **runtime guard**: if a
`CSSTemplate`ever reaches an attribute updater, **throw** with a clear message rather than
stringify to`[object Object]`. That guard also *simplifies* the v1 `style=`fast path — it
only ever accepts strings and objects, never a`css\`\``.

### v1 forward-compat commitments

Each row is something v1 must do (or deliberately leave interceptable) so v2 is additive,
not a rewrite.

| #   | v1 must do                                                                                                                 | v2 adds                                                             | why it'd be a rewrite otherwise                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | address holes by **local ordinal + a resolver**, not parent expression indices baked into the plan                         | swap the resolver to descend into a child `CSSTemplate.expressions` | the plan would hard-code parent indexing; child splices can't reuse it           |
| 2   | custom-property names = `--` + **discriminator** + ordinal (discriminator a parameter; v1 = `templateHash` base36)         | fresh discriminator per splice occurrence                           | same `css\`\``spliced twice with different values would collide on`--cN`         |
| 3   | carrier = `styleEl.getRootNode().host` resolved **at setup** (not a threaded host binding)                                 | spliced children inherit the same carrier for free                  | nested-template `<style>` (host=null) and spliced children would have no carrier |
| 4   | `assembleSheet(plan, resolve) → string` is the **only** (pure) way sheet text is built                                     | `resolve`/assemble recurse at merge holes                           | string-building scattered across sites; can't make it recursive later            |
| 5   | analyzer **always** emits the full per-group plan (incl. structural groups) and tracks **brace depth** (at-rules, nesting) | merge/structural holes read the same per-group data                 | a v1 that only recorded "value holes" loses the structure v2 needs               |
| 6   | structural-hole resolution is a runtime **type branch left interceptable** (v1: string → reparse)                          | `isCSSTemplate(value)` → merge, else reparse                        | a hard `reparse` with no branch point can't be extended to merge                 |
| 7   | **deterministic** names + assemble — no per-instance counters / random                                                     | SSR↔CSR hydration of spliced sheets agrees                          | nondeterministic names break hydration the moment `css\`\`` ships                |
| 8   | analyzer input is the \*\*normalized interleaved `(staticString                                                            | holeRef)[]`** shared by `<style>`bindings and`css\`\``              | `css\`\``feeds its own`strings`+ values as`holeRef`s                             | two analyzers (one per source) would diverge and double the surface |

### Perf guards (so forward-compat costs nothing in v1)

- The per-frame **top-level** path stays array-direct and monomorphic — **no closure in the
  hot loop**. The resolver indirection (#1) and recursion (#4) live only on the **cold**
  merge/structural path.
- `css\`\``gets its **own`cssCache`WeakMap** keyed on its`strings`identity — it never
contends with`htmlCache`.
- Per CONVENTIONS rule 15: the analyzer's per-group classification is computed once and
  stored on the plan; the updater reads stored kind bytes, never re-probes.

### v2-only (explicitly deferred)

- the splice/merge mechanism itself
- the `isCSSTemplate` branch at structural holes
- recursive `assembleSheet`
- splice-result caching
- content-position sugar (`${style}` → a scoped `<style>`)
- `css\`\`` is orthogonal to the var-indirection-vs-rule-index choice — either backend merges it

### Out of scope (not planned)

- `css\`\``in the`style`attribute (flat declaration list, not a stylesheet) — use`style=${obj}`
- `css\`\``in`class` / any attribute — a stylesheet is not a class; no global/auto-scoped class generation
- `css\`\``as an independent reactive unit — it's a value the parent's`update()`re-produces (honors ADR-0004), like a nested`HTMLTemplate`
- `adoptedStyleSheets` (incompatible with current SSR) — though the same merge unit could feed it later

**Design rule that keeps `css\`\`` from being a separate world:** the analyzer consumes the
normalized interleaved `(staticString | holeRef)[]` of commitment #8 — the shape
`binding.values` already has. `<style>` feeds parent expression indices; `css\`\``feeds its
own`strings`+ values (local refs). Same analyzer, same plan shape. A spliced child applies
its plan with its own expressions on the **shared carrier** (custom properties inherit),
coordinated by the parent`HTMLTemplate` that owns the expression holding the css result.

## The CSS declaration analyzer

A small resumable tokenizer over the binding's static segments, classifying each hole by
position:

- **`<style>` tag** — needs selector/block/at-rule awareness:
  - hole in a declaration **value** (inside `{ … }`, after `:`) → `value` (fast).
  - hole in a **property name**, **selector**, **at-rule prelude**, or a whole-stylesheet
    hole → `structural` (fallback in v1).
- **`style` attribute** — strictly simpler: a flat declaration list, no selectors, no
  at-rules, no nesting. Start already "inside a block":
  - hole in a **value** → `value` (fast, direct `setProperty`).
  - hole in a **property name** → safe to `setProperty(dynamicName, value)` directly (we own
    the element); v1-or-fast-follow. Track the name to `removeProperty` when it changes.
  - `style=${x}` (one opaque hole, no static structure) → **owned-keys reconciler**: accept
    string or object, normalize to declarations, track the property set this binding owns,
    on update diff next vs. previous → `setProperty` changed / `removeProperty` dropped.
    `null`/`undefined`/`false` → `removeProperty`. Never `setAttribute` (preserves
    composition with other `setProperty` writers).

The analyzer is the bulk of the work and is shared verbatim with a future rule-index
implementation.

## Implementation steps

1. **Analyzer** (`parser/css.ts`, new): resumable declaration tokenizer; produces a
   `cssPlan` — ordered groups, each `{ kind: 'value' | 'structural', expressionIndices,
staticPrefixes }`, plus a top-level `structural: boolean` short-circuit.
2. **Attach plan at parse time**: extend `RawContentBinding` / `AttributeBinding` with
   optional `cssPlan`; compute it where `completeSpecialContent` builds the binding
   (`parser/html.ts:248`) and where the parser finalizes a `style` ATTR binding. Rides the
   existing parse cache.
3. **Shared apply primitive** (`rendering/css-apply.ts`, new): `applyGroups(styleDecl,
plan, resolve, previous)` — per-group diff + `setProperty`/`removeProperty`. `resolve` is
   the hole→value indirection required by `css\`\``commitment #1; the primitive **never
indexes parent expressions directly**. In v1 the caller passes the trivial`(group, ordinal) => current[group.expressionIndices[ordinal]]`, so the seam exists from
day one at no cost. v2 swaps `resolve`to descend into a child`CSSTemplate.expressions`;
the primitive is unchanged. Keep `resolve` out of the hot per-group loop's closure scope —
   pass it once, call it per hole. Plus the owned-keys reconciler for the whole-hole
   attribute case.
4. **Tag updater**: in `updateRawContent`, branch on `cssPlan`. If `value`/mixed-eligible:
   on setup, **unless the `<style>` is already SSR-populated** (see the hydration note in
   Architecture §3), build the static sheet via `assembleSheet(plan, resolve)` — the _only_
   sheet-text builder (commitment #4; non-recursive in v1, recurses at merge holes in v2) —
   then resolve the carrier and `setProperty` each group's `--cN` on it; on update call
   `applyGroups(carrier.style, plan, resolve, previous)`. Else: today's `textContent` path.
5. **Attribute updater**: special-case `style` off the `setAttribute` stringable path in
   `applyAttributeBinding` (`rendering/attribute.ts:60`); route to the direct/​reconciler
   pathway.
6. **Carrier resolution for the tag**: the custom properties must land on the component host
   (so `var()` inherits through the shadow boundary to wherever the selector matches). Resolve
   the carrier **once at setup** as `styleEl.getRootNode().host` (commitment #3 — this also
   covers a nested-template `<style>` whose own binding host is null, and a spliced `css\`\``child that inherits the parent's carrier). If`getRootNode()`returns the document
(light-DOM / top-level use),`.host`is`undefined`→ no carrier → fall back to the`textContent` path for that binding. The lib targets shadow roots; this is the honest
   degenerate path, not an error.
7. **Tests**: value hole, multi-hole value group, property-name hole (attr), whole-hole
   `style=${obj}` reconcile + removal, structural fallback (selector/at-rule hole), SSR
   fallback correctness, composition (two writers don't clobber).
8. **Revert cube spikes** once the library path lands: `scene-camera.ts` (restore world-side
   `--camera-*` portability) and `scene-gizmo.ts`.

## Open questions

- **Property-name holes in `<style>` `:host { ${p}: v }`**: directly `setProperty`-able on
  host (name is a runtime string), but reliably detecting `:host` adds selector parsing.
  Defer to fallback in v1; revisit.
- **Partial fallback** for mixed sheets (fast groups + one structural hole) vs. v1
  wholesale fallback — measure before adding complexity.
- **Custom-property name collisions** across multiple `<style>` instances on the same host:
  `--cN` indices are per-template; confirm host-scoping is unambiguous when a component
  renders nested templates that also emit styles.
- **`removeProperty` vs. empty string** semantics for value groups that become
  `null`/`undefined` mid-life — align with the attribute reconciler.
