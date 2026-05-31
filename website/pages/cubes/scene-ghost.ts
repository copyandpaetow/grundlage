import { html, render } from "../../../lib/src";
import { resolveTriple, UNIT_SIZE } from "./scene-shared";

// <scene-ghost> — the placement preview. It wraps the geometry being placed
// (<scene-ghost><scene-cube/></scene-ghost>) and carries the grid-snapped preview
// position, so the slotted child shows the real shape at the real spot, just
// translucent and inert. On drop the editor lifts the child out at the ghost's
// position and discards the ghost — the same wrap/unwrap shape as the gizmo.
// Editor-only: it is never serialized, and `pointer-events` here cascades to the
// previewed child so the preview can't be clicked.
//
// Translucency is the subtle part: setting `opacity` on this wrapper would create
// a group that FLATTENS the child's preserve-3d, collapsing the ghost to a 2D
// silhouette. Instead we hand the child an inherited `--block-opacity`, which its
// faces apply per-face (each face is a single plane, so dimming it stays 3D). The
// custom property inherits across the slot into the child's shadow, so the ghost
// dims the real geometry without ever touching its 3D context.

const POSITION_SPECIFIC = ["x", "y", "z"] as const;

customElements.define(
	"scene-ghost",
	render(function* (element) {
		yield () => {
			const [positionX, positionY, positionZ] = resolveTriple(
				element,
				"position",
				POSITION_SPECIFIC,
				0,
			);
			return html`
				<style>
					:host {
						position: absolute;
						top: 50%;
						left: 50%;
						transform-style: preserve-3d;
						pointer-events: none;
						/* Inherits across the slot into the child's faces; dims the
						   preview per-face so the 3D context survives (see note above). */
						--block-opacity: 0.45;

						--block-x: ${positionX * UNIT_SIZE}px;
						--block-y: ${-positionY * UNIT_SIZE}px;
						--block-z: ${positionZ * UNIT_SIZE}px;

						transform: translate3d(
							var(--block-x),
							var(--block-y),
							var(--block-z)
						);
					}

					/* Children share the ghost's 3D context, so the slot must not flatten. */
					slot {
						display: contents;
					}
				</style>
				<slot></slot>
			`;
		};
	}),
);
