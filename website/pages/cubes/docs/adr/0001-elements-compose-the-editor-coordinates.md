# Geometry elements compose; the editor coordinates

The Gizmo, Cage, and Block are independent drop-in custom elements that compose by
nesting (`gizmo > cage > blocks`) and never call into or mutate one another. The Gizmo is
a generic transform tool that reads/writes the transform of its **direct child only** —
Block, group, Cage, any Transform carrier — so to let it drive a Cage we made the Cage a
Transform carrier rather than have the Gizmo reach through it. The editor is the sole
coordinator: it owns the wrapping and, after each Gizmo commit, Flattens the Cage's
transform down into the leaf Blocks so the wrappers never become a hidden second source
of truth.

## Considered Options

- **Status quo (rejected): the Gizmo reaches through the Cage.** The Gizmo found its
  blocks through the Cage's slot and called the Cage's `writeBounds()` every frame. This
  hard-wired the Gizmo to one specific child type and made the two elements
  un-composable — the dataflow the principle "a wrapper touches only its own direct
  content" exists to forbid.
- **Flatten only at deselect (rejected).** Would let the Cage hold a persistent transform
  like a temporary group, but leaves Blocks stale during a selection (forcing the
  inspector and export to compose the wrapper transform) and reintroduces the bake-back
  the design avoids. We flatten at every commit instead.

## Consequences

- Everything routes through the one render channel (see lib ADR-0004: no imperative DOM
  side-lane). The Gizmo and Cage do **not** observe their own content; the editor, which
  owns every content change (fold in/out, inspector edit, Flatten), re-renders them via
  `update()`. A component spying on its own subtree to react to changes it or its
  coordinator caused is the anti-pattern this avoids.
- The Cage (`scene-select`) is a Render function: it resolves `position`/`rotation` into
  its committed carrier transform and MEASURES its blocks at render time, emitting the box
  size as bindings — no `writeBounds()` method, no imperative style writes, no observer.
- The live drag is a declared, inherited custom property, not a cross-element write. The
  Gizmo DECLARES `--carrier-live: matrix3d(…)` on its own `:host`; it inherits across the
  slot to the direct child, whose `:host` pulls it (`transform: var(--carrier-live,
  <committed>)`). The child and its contents ride the drag by pure CSS inheritance — the
  Gizmo touches nothing inside the child. Commit writes the child's authored attributes,
  clears `--carrier-live` (once the child has re-rendered against them, so no flash), and
  fires `scene-commit`.
- The editor Flattens on each `scene-commit` (reusing the matrix compose / Euler
  decompose already written for ungroup), keeping Blocks the single source of truth and
  the "unwrapping needs no bake-back" invariant intact.
