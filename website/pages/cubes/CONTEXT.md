# Cubes Editor

A DOM-as-geometry 3D editor: custom elements *are* the geometry (pure CSS-3D, no
canvas/WebGL). This context is the editor layered over them — selection, manipulation,
grouping, placement. Distinct from the [Grundlage](../../../lib/CONTEXT.md) templating
library it is built with.

## Language

**Block**:
Any transformable geometry element — a cube, wall, ramp, or group. The thing a Gizmo
moves and a Cage wraps. Identified by `isBlock` / `BLOCK_TAGS`.
_Avoid_: shape, mesh, object, node.

**Transform carrier**:
An element that turns its own transform state into a CSS transform on its host, carrying
its content as one rigid unit. Two channels feed it, both declaratively: authored
attributes (`position`, `rotation`) for the committed value, and — for the Cage — an
inherited `--carrier-live` for the in-flight value during a drag, which a wrapping Gizmo
declares on its own host and the carrier pulls (`transform: var(--carrier-live,
<committed>)`). No one writes the carrier's DOM. This shared contract is what lets a Gizmo
drive its child uniformly.
_Avoid_: transformable, movable.

**Gizmo**:
The manipulation knobs (`scene-gizmo`). A generic transform tool: it reads and writes
the transform of its **direct child only** — Block, group, Cage, any Transform carrier —
and never reaches through to descendants or names what its child is. Live drag declares
`--carrier-live` on its own host for the child to pull; commit writes the child's authored
attributes, clears `--carrier-live`, and fires `scene-commit`.
_Avoid_: manipulator, controls. (Handle/Knob are its parts, not the whole.)

**Handle** (a.k.a. **Knob**):
A single draggable part of the Gizmo — one per axis (x/y/z) plus yaw. Not selectable.

**Cage**:
The selection highlight (`scene-select`): a box fitted to its own slotted content. It
measures its blocks at render time and emits the box as bindings (no observer, no
imperative writes); the Editor re-renders it through `update()` when content changes. It
is itself a Transform carrier, so a Gizmo can move it as a unit. At rest the box is
world-axis-aligned.
_Avoid_: highlight, outline, selection box, bounding box (that last is the math —
`blocksBoundsPx` — not the element).

**Selection**:
The wrapping of the chosen Blocks as `gizmo > cage > blocks`. The wrappers' *existence*
is the selection; no `selected` attribute lives on the geometry. One Cage holds one or
many Blocks, so a single- and multi-Block selection are the same structure.
_Avoid_: active, focused.

**Flatten**:
Baking a wrapper's transform down into its leaf Blocks' authored attributes (matrix
compose + Euler decompose). The Editor does this — after a Gizmo commit, and on ungroup —
so the wrappers never become a hidden second source of truth.
_Avoid_: bake, apply, commit (commit is the Gizmo event; flattening is the Editor's
follow-up).
