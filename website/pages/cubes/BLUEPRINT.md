# Cube Framework Blueprint

## Element Family

### `<cube-scene>`
The root container. Defines camera and projection settings.

**Attributes:**
- `perspective` — CSS perspective value (e.g. `2000px`)

Rotation (degrees):
- `pan` — rotation around Y axis (left/right swivel)
- `tilt` — rotation around X axis (up/down nod)
- `roll` — rotation around Z axis (clockwise/counter-clockwise)

Translation:
- `truck` — move camera left/right (X axis)
- `pedestal` — move camera up/down (Y axis)
- `dolly` — move camera forward/back (Z axis)

**Responsibilities:**
- Applies CSS 3D transforms for the viewing angle
- Responsive: scene fills its container width
- Hosts a `ResizeObserver` to recalculate unit sizes when the container resizes

---

### `<cube-grid>`
A container that defines an interior 3D coordinate space. Shows **inside** faces (walls of a room).

**Attributes (positioning — shared with `cube-block`):**
- `x`, `y`, `z` — position within parent grid (values can be integers or `start` | `center` | `end`, default: `1`) 
- `width`, `height`, `depth` — how many units this element consumes in the parent grid (default: `1`)

**Attributes (coordinate space):**
- `units` — number of units per axis (e.g. `units="10"` = 10×10×10)
- `units-width`, `units-height`, `units-depth` — per-axis overrides
- `size` — explicit unit size; if omitted, derived responsively from scene width / units
- `size-width`, `size-height`, `size-depth` — per-axis overrides

**Slots:**
- Default slot — child `cube-grid` / `cube-block` elements
- `top`, `bottom`, `left`, `right`, `front`, `back` — named slots for wall content

**CSS Parts (for simple styling without slots):**
- `::part(top)`, `::part(bottom)`, `::part(left)`, `::part(right)`, `::part(front)`, `::part(back)`

**Behavior:**
- Nesting: a `cube-grid` inside another `cube-grid` consumes space in the parent like a block, but resets the internal coordinate system
- Inherits parent `size` if not explicitly set
- Maintains an internal representation of occupied cells (heightmap / 3D grid) for auto-positioning and future culling

---

### `<cube-block>`
A placed volume that shows **outside** faces.

**Attributes (shared with `cube-grid`):**
- `x`, `y`, `z` — position within parent grid (values can be integers or `start` | `center` | `end`, default: `1`) 
- `width`, `height`, `depth` — how many units this element consumes (default: `1`)

**Slots:**
- `top`, `bottom`, `left`, `right`, `front`, `back` — named slots for face content

**CSS Parts:**
- `::part(top)`, `::part(bottom)`, `::part(left)`, `::part(right)`, `::part(front)`, `::part(back)`

---

## Layout Rules

### Coordinate System
- Origin `(0, 0, 0)` is the **far back, bottom-left** corner
- X increases to the right
- Y increases upward
- Z increases toward the viewer

### Auto-Positioning
- If an axis is omitted, the element is placed at the **lowest available position** on that axis (closest to origin)
- Stacking considers the **full footprint** of each element, not just its origin cell
- Conflict resolution: **HTML reading order** — first in markup = closest to origin

### Size vs. Position
- **Position wins.** If a block overflows its parent grid, it clips/overflows but the stated position is respected
- Emit a dev-mode warning when overflow occurs

---

## Responsive Sizing
- If `size` is omitted on a `cube-grid`, unit size is derived from the scene's rendered width
- Calculation must account for the isometric projection: visible width is a function of `units`, `tilt`, and `pan`
- `size` as an explicit attribute opts into fixed dimensions regardless of container

---

## Open Questions / Future Considerations
- [ ] Culling: hide faces that are not visible (blocked by adjacent blocks or facing away)
- [ ] Rotation on individual elements (currently scene-level only)
- [ ] Animation support
- [ ] How to handle interactive content on wall slots (pointer events, face visibility)
- [ ] Dev-mode warnings (overflow, overlapping blocks)
