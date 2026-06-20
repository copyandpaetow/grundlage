# One render channel: all output flows through `update()`, no imperative DOM side-lane

Every change to a component's rendered output — content, gestures, and animation alike —
is produced by re-running its Producer through `update()`. An author changes closure state
and calls `update()` (directly from an event stream like `pointermove`/`scroll`, from a
`requestAnimationFrame` loop for time-based animation, or from a `MutationObserver` for
slotted-content changes), and the template's per-binding diff writes the DOM. An author
never writes the rendered tree imperatively. A measured value (FLIP, a fit-to-content box)
reaches markup only through a Render generator's second `yield` — render → measure the live
tree → render again — never through a `style.set*` from outside the render.

## Why

The library's job is to make DOM operations sparse. Making `update()` the _only_ writer is
what lets it: repeated calls coalesce on a microtask, and the per-binding dirty-check writes
only what changed, so even a 60fps gesture routed through the channel touches the minimum
DOM. A second, imperative "fast lane" would defeat that — it forks the mental model and moves
write-scheduling out of the one place that can keep it minimal and predictable. The author
expresses _intent_ ("re-render, here's the new state"); the library owns performance.

## Considered Options

- **An imperative fast path for hot updates (rejected).** The intuition is that a drag is
  "too frequent" for a template diff. But microtask batching already collapses many
  `pointermove`s into one render per frame, and the diff writes only the changed binding —
  so the channel is already as sparse as a hand-tuned write, without a second model.
- **Class extension as a first-class API (rejected, kept as an escape hatch).** A component
  can extend the generated class to expose a public method, but the DX is deliberately worse
  than authoring in the generator. It stays available for the rare genuine need; it is not
  the idiom, so the declarative path remains the obvious one.
- **A cross-component `setProp` push for parent→child state (rejected).** See ADR-0003: a
  push does not pin _when_ the target re-renders, standardizing a race rather than removing
  it. Peers coordinate by event and pull their inputs from durable element state at render
  time. A parent that must drive a child's render state does so through durable state the
  child already pulls (an attribute, or an inherited custom property declared in the parent's
  own template), not by reaching into the child's DOM.

## Consequences

- Components that depend on something _other_ than their own attributes (slotted content, an
  external "re-pin" signal) get no automatic re-render; the author wires the trigger to
  `update()`. The coordinator that caused the change is the right place to call it — a
  component spying on its own subtree to react to changes it or its coordinator caused is the
  anti-pattern this rules out.
- "Measure" stays a _read_ feeding the next render. The only genuinely DOM-dependent reads
  are ones the browser alone can answer (e.g. a perspective-projected screen position via
  `getBoundingClientRect`); those belong in a handler or a Render generator's measure step,
  feeding closure state, never writing the tree.
