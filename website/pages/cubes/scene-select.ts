import { html, render } from "../../../lib/src";
import { resolveTriple, UNIT_SIZE } from "./scene-shared";

// <scene-select> — the co-selection highlight. Selecting extra blocks for grouping
// wraps each one (<scene-select><scene-cube/></scene-select>); deselecting unwraps
// it. Like the gizmo, the wrapper's existence IS the highlight — so the geometry
// elements carry no `[co-selected]` rule and stay ignorant of selection entirely.
//
// The wrapper sits at the world centre (zero size) exactly like the gizmo, lets the
// child render through the slot unchanged, and draws a bright cage that mirrors the
// child's transform and sits a few px OUTSIDE its faces. The outset matters: a cage
// flush with the opaque faces would z-fight and stay invisible, which is why the
// highlight wasn't showing. The child stays the single source of truth — we only
// read its position/rotation/size and follow it (a MutationObserver keeps the cage
// pinned if the child's attributes change).

const POSITION_SPECIFIC = ["x", "y", "z"] as const;
const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;
const SIZE_SPECIFIC = ["width", "height", "depth"] as const;

const HALF_UNIT = UNIT_SIZE / 2;
// Screen-px the cage stands proud of each face, so it reads as a halo around the
// block rather than fighting with its surface.
const SELECT_MARGIN = 8;

type Triple = [number, number, number];

customElements.define(
	"scene-select",
	render(function* (element) {
		let child: HTMLElement | null = null;
		let childObserver: MutationObserver | null = null;

		// Mirror the child's transform onto the cage and size it from the child's
		// half-extents (+ a margin) so it floats just outside the block.
		const syncBox = (): void => {
			const box = element.shadowRoot?.querySelector(
				".box",
			) as HTMLElement | null;
			if (box === null || child === null) return;
			const [px, py, pz] = resolveTriple(
				child,
				"position",
				POSITION_SPECIFIC,
				0,
			) as Triple;
			const [rx, ry, rz] = resolveTriple(
				child,
				"rotation",
				ROTATION_SPECIFIC,
				0,
			) as Triple;
			const size = resolveTriple(child, "size", SIZE_SPECIFIC, 1) as Triple;
			box.style.setProperty("--block-x", `${px * UNIT_SIZE}px`);
			box.style.setProperty("--block-y", `${-py * UNIT_SIZE}px`);
			box.style.setProperty("--block-z", `${pz * UNIT_SIZE}px`);
			box.style.setProperty("--block-rotate-x", `${rx}deg`);
			box.style.setProperty("--block-rotate-y", `${ry}deg`);
			box.style.setProperty("--block-rotate-z", `${rz}deg`);
			(["x", "y", "z"] as const).forEach((axis, index) => {
				box.style.setProperty(
					`--half-${axis}`,
					`${size[index] * HALF_UNIT + SELECT_MARGIN}px`,
				);
			});
		};

		yield html`
			<style>
				:host {
					position: absolute;
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					pointer-events: none;
				}

				/* The cage: mirrors the child's translate + rotate; its extent comes
				   from --half-* (the child's half-size plus a margin). Never solid, never
				   eats pointer events — purely a "these belong together" cue. */
				.box {
					position: absolute;
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					pointer-events: none;
					transform: translate3d(
							var(--block-x, 0px),
							var(--block-y, 0px),
							var(--block-z, 0px)
						)
						rotateX(var(--block-rotate-x, 0deg))
						rotateY(var(--block-rotate-y, 0deg))
						rotateZ(var(--block-rotate-z, 0deg));
				}

				.edge {
					position: absolute;
					top: 50%;
					left: 50%;
					box-sizing: border-box;
					border: 2px dashed rgba(120, 220, 255, 0.95);
					background: rgba(120, 220, 255, 0.1);
				}
				.front,
				.back {
					width: calc(2 * var(--half-x, ${HALF_UNIT}px));
					height: calc(2 * var(--half-y, ${HALF_UNIT}px));
					margin: calc(-1 * var(--half-y, ${HALF_UNIT}px)) 0 0
						calc(-1 * var(--half-x, ${HALF_UNIT}px));
				}
				.front {
					transform: translateZ(var(--half-z, ${HALF_UNIT}px));
				}
				.back {
					transform: translateZ(calc(-1 * var(--half-z, ${HALF_UNIT}px)));
				}
				.right,
				.left {
					width: calc(2 * var(--half-z, ${HALF_UNIT}px));
					height: calc(2 * var(--half-y, ${HALF_UNIT}px));
					margin: calc(-1 * var(--half-y, ${HALF_UNIT}px)) 0 0
						calc(-1 * var(--half-z, ${HALF_UNIT}px));
				}
				.right {
					transform: rotateY(90deg) translateZ(var(--half-x, ${HALF_UNIT}px));
				}
				.left {
					transform: rotateY(-90deg) translateZ(var(--half-x, ${HALF_UNIT}px));
				}
				.top,
				.bottom {
					width: calc(2 * var(--half-x, ${HALF_UNIT}px));
					height: calc(2 * var(--half-z, ${HALF_UNIT}px));
					margin: calc(-1 * var(--half-z, ${HALF_UNIT}px)) 0 0
						calc(-1 * var(--half-x, ${HALF_UNIT}px));
				}
				.top {
					transform: rotateX(90deg) translateZ(var(--half-y, ${HALF_UNIT}px));
				}
				.bottom {
					transform: rotateX(-90deg) translateZ(var(--half-y, ${HALF_UNIT}px));
				}

				/* The wrapped child shares our 3D context, so the slot must not flatten. */
				slot {
					display: contents;
				}
			</style>
			<div class="box">
				<div class="edge front"></div>
				<div class="edge back"></div>
				<div class="edge right"></div>
				<div class="edge left"></div>
				<div class="edge top"></div>
				<div class="edge bottom"></div>
			</div>
			<slot></slot>
		`;

		const slot = element.shadowRoot?.querySelector("slot");
		const onSlotChange = (): void => {
			child = (slot?.assignedElements()[0] as HTMLElement | undefined) ?? null;
			childObserver?.disconnect();
			if (child !== null) {
				childObserver = new MutationObserver(syncBox);
				childObserver.observe(child, { attributes: true });
			}
			syncBox();
		};
		slot?.addEventListener("slotchange", onSlotChange);
		onSlotChange();

		return () => {
			slot?.removeEventListener("slotchange", onSlotChange);
			childObserver?.disconnect();
		};
	}),
);
