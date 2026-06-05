import { html, render } from "../../../lib/src";
import {
	blocksBoundsPx,
	eulerFromMatrix,
	formatNumber,
	frameMatrix,
	fromScreenPoint,
	resolveBlockTransform,
	UNIT_SIZE,
	type Vector3,
} from "./scene-shared";

// <scene-gizmo> — the manipulation knobs, and nothing else. It is a GENERIC transform
// tool: it reads and writes the transform of its ONE direct child and never looks past
// it. That child can be a block, a group, or a <scene-select> cage — the gizmo treats
// them all the same, because every Transform carrier honours the same contract: authored
// `position`/`rotation` for the committed value, and an inherited `--carrier-live` for the
// in-flight one.
//
// Everything the gizmo renders is declarative. The handle frame's position and length,
// and the live drag transform, are all `:host` bindings fed by closure state and re-run
// through update() — there are no imperative DOM writes. A drag is a SINGLE matrix:
//   - live: we DECLARE `--carrier-live: matrix3d(…)` on our host. It inherits across the
//     slot to the child, whose :host pulls it (`transform: var(--carrier-live, committed)`),
//     so the child and whatever it wraps ride the drag as one rigid body — moved by pure
//     CSS inheritance, with no JS touching the child and nothing measured per frame.
//   - drop: we write the child's authored attributes, then clear `--carrier-live` only once
//     the child has re-rendered against them (so the committed transform already equals the
//     live one — no flash), and bubble `scene-commit`. The editor then flattens the child's
//     transform into the leaf blocks; the gizmo neither knows nor cares.
//
// The handle frame is WORLD-axis-aligned (it follows the child's bounding-box centre, never
// its rotation) so the handles never swing behind a turned block and the X/Y/Z handles line
// up with the world axes they drive. Drag projection is the one genuinely DOM-dependent read:
// the gizmo measures its own handle knobs (already perspective-projected by the browser) and
// turns a pointer delta into world units with one dot product — no camera matrix.

const HANDLE_LENGTH = UNIT_SIZE;
const YAW_PER_PIXEL = 0.5;
// Screen-px a knob sits beyond the child's bounding box, so the handles always clear the
// cage whatever the selection's size.
const HANDLE_MARGIN = 44;

type ScreenPoint = { x: number; y: number };
type DragMode = "x" | "y" | "z" | "yaw";

const dot = (a: ScreenPoint, b: ScreenPoint): number => a.x * b.x + a.y * b.y;

const centerOf = (rectangle: DOMRect): ScreenPoint => ({
	x: rectangle.left + rectangle.width / 2,
	y: rectangle.top + rectangle.height / 2,
});

const addPx = (point: Vector3, delta: Vector3): Vector3 => [
	point[0] + delta[0],
	point[1] + delta[1],
	point[2] + delta[2],
];

customElements.define(
	"scene-gizmo",
	render(function* (element) {
		// The handle frame, in screen-px world space: where the knobs sit (the child's bbox
		// centre) and how far out each axis reaches (its half-extent + margin). These are the
		// closure state the render reads; a non-drag render re-measures them from the child, a
		// drag render derives the centre from the gesture instead.
		let handleCenterPx: Vector3 = [0, 0, 0];
		let handleLengthsPx: Vector3 = [HANDLE_LENGTH, HANDLE_LENGTH, HANDLE_LENGTH];

		let drag:
			| {
					mode: DragMode;
					axisIndex: number;
					startPointer: ScreenPoint;
					// Screen displacement for ONE world unit along the dragged axis.
					axisScreen: ScreenPoint;
					target: HTMLElement;
					// The child's transform when the drag began (screen-px world space).
					startMatrix: DOMMatrix;
					startCenterPx: Vector3;
					// What the latest move produced — read straight from here by the render
					// (--carrier-live) and the commit (the authored attributes).
					liveMatrix: DOMMatrix;
					centerPx: Vector3;
			  }
			| null = null;

		// Our one slotted child — whatever it is. The gizmo drives THIS element's transform
		// and nothing inside it.
		const child = (): HTMLElement | null => {
			const slot = element.shadowRoot?.querySelector("slot");
			const assigned = (slot?.assignedElements() ?? [])[0];
			return assigned instanceof HTMLElement ? assigned : null;
		};

		// The child's committed transform as a screen-px matrix (translate · rotate).
		const childMatrix = (target: HTMLElement): DOMMatrix => {
			const { position, rotation } = resolveBlockTransform(target);
			return frameMatrix(position, rotation);
		};

		const handlePoint = (selector: string): ScreenPoint => {
			const node = element.shadowRoot?.querySelector(
				selector,
			) as HTMLElement | null;
			return node ? centerOf(node.getBoundingClientRect()) : { x: 0, y: 0 };
		};

		const onPointerMove = (event: PointerEvent): void => {
			if (drag === null) return;
			const active = drag;
			const delta: ScreenPoint = {
				x: event.clientX - active.startPointer.x,
				y: event.clientY - active.startPointer.y,
			};

			if (active.mode === "yaw") {
				// Rotate the whole child about its bbox centre: a pivot matrix premultiplied
				// onto the start transform. For a cage this orbits + spins every block as one
				// rigid body; for a lone block (centre == its origin) it is a spin in place.
				const degrees = delta.x * YAW_PER_PIXEL;
				const [cx, cy, cz] = active.startCenterPx;
				const pivot = new DOMMatrix(
					`translate3d(${cx}px, ${cy}px, ${cz}px) rotateY(${degrees}deg) translate3d(${-cx}px, ${-cy}px, ${-cz}px)`,
				);
				active.liveMatrix = pivot.multiply(active.startMatrix);
				// The pivot is the bbox centre, so it is fixed under the rotation — the
				// world-aligned handle frame stays put.
				active.centerPx = active.startCenterPx;
			} else {
				const lengthSquared = dot(active.axisScreen, active.axisScreen);
				const units =
					lengthSquared === 0
						? 0
						: dot(delta, active.axisScreen) / lengthSquared;
				const offsetPx = units * UNIT_SIZE;
				// World axis → world-CSS-px direction (author +Y is up = screen −Y).
				const translatePx: Vector3 =
					active.axisIndex === 0
						? [offsetPx, 0, 0]
						: active.axisIndex === 1
							? [0, -offsetPx, 0]
							: [0, 0, offsetPx];
				const slide = new DOMMatrix(
					`translate3d(${translatePx[0]}px, ${translatePx[1]}px, ${translatePx[2]}px)`,
				);
				active.liveMatrix = slide.multiply(active.startMatrix);
				// The handle frame slides by the same world delta, so the knobs follow live.
				active.centerPx = addPx(active.startCenterPx, translatePx);
			}
			// One channel: the move changed our state, so re-render. The child rides the new
			// --carrier-live by inheritance; the handles re-pin to active.centerPx.
			void element.update();
		};

		const commitDrag = (): void => {
			if (drag === null) return;
			const settled = drag;
			const target = settled.target;
			const matrix = settled.liveMatrix;
			// Hand the child its RAW dragged transform. This carrier transform is an
			// intermediate the editor flattens into the leaf blocks and then zeroes, and
			// flatten snaps THOSE blocks — so snapping here would only inject a grid-sized
			// jump (worst for a yaw, whose off-origin pivot puts a large translation in the
			// matrix). Grid snapping is the editor's job, not this generic tool's.
			const position = fromScreenPoint(
				new DOMPoint(matrix.m41, matrix.m42, matrix.m43),
			) as Vector3;
			const rotation = eulerFromMatrix(matrix) as Vector3;
			target.setAttribute("position", position.map(formatNumber).join(" "));
			target.setAttribute("rotation", rotation.map(formatNumber).join(" "));
			target.removeAttribute("x");
			target.removeAttribute("y");
			target.removeAttribute("z");

			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);

			// The authored attributes are written, but --carrier-live still holds the dragged
			// matrix (our last render), so the child does not move. Once the child has
			// re-rendered from its attributes — by which point its committed transform equals
			// the live one — we drop the drag and re-render, clearing --carrier-live with no
			// flash, then tell the editor the transform settled so it can flatten.
			const settledTarget = target as { update?: () => Promise<void> };
			const cleared = Promise.resolve(settledTarget.update?.());
			drag = null;
			void cleared.then(() => {
				void element.update();
				element.dispatchEvent(
					new CustomEvent("scene-commit", { bubbles: true }),
				);
			});
		};

		const onHandleDown = (rawEvent: Event): void => {
			const event = rawEvent as PointerEvent;
			if (event.button !== 0) return;
			const target = child();
			if (target === null) return;
			const handle = (event.target as HTMLElement)?.closest("[data-axis]");
			if (!(handle instanceof HTMLElement)) return;
			const mode = handle.dataset.axis as DragMode;
			// Keep the editor's host listener from treating this as a select/deselect.
			event.preventDefault();
			event.stopPropagation();

			const bounds = blocksBoundsPx([target]);
			if (bounds === null) return;
			const axisIndex = mode === "x" ? 0 : mode === "y" ? 1 : 2;
			let axisScreen: ScreenPoint = { x: 0, y: 0 };
			if (mode !== "yaw") {
				const origin = handlePoint("#origin");
				const tip =
					mode === "x"
						? handlePoint("#knob-x")
						: mode === "y"
							? handlePoint("#knob-y")
							: handlePoint("#knob-z");
				// The knob sits handleLengthsPx px from the origin = that / UNIT_SIZE world
				// units out; scale its screen offset down to a single world unit so the
				// dot-product projection yields world units directly.
				const worldUnitsOut = handleLengthsPx[axisIndex] / UNIT_SIZE;
				const scale = worldUnitsOut === 0 ? 0 : 1 / worldUnitsOut;
				axisScreen = {
					x: (tip.x - origin.x) * scale,
					y: (tip.y - origin.y) * scale,
				};
			}
			const startMatrix = childMatrix(target);
			drag = {
				mode,
				axisIndex,
				startPointer: { x: event.clientX, y: event.clientY },
				axisScreen,
				target,
				startMatrix,
				startCenterPx: bounds.center,
				liveMatrix: startMatrix,
				centerPx: bounds.center,
			};
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", commitDrag);
		};

		// A Render function: re-invoked on every update(). A non-drag render measures the
		// child to place the handle frame; a drag render takes the frame from the gesture and
		// declares the live transform. Both emit only bindings — no imperative DOM writes.
		yield () => {
			if (drag === null) {
				const bounds = blocksBoundsPx(child() === null ? [] : [child()!]);
				if (bounds !== null) {
					handleCenterPx = bounds.center;
					handleLengthsPx = [
						bounds.half[0] + HANDLE_MARGIN,
						bounds.half[1] + HANDLE_MARGIN,
						bounds.half[2] + HANDLE_MARGIN,
					];
				}
			} else {
				handleCenterPx = drag.centerPx;
			}
			// Unset (initial) when idle, so the child's var() falls back to its committed
			// transform; the dragged matrix while a gesture is live.
			const carrierLive =
				drag === null ? "initial" : (drag.liveMatrix.toString() as string);

			return html`
				<style>
					:host {
						position: absolute;
						/* Zero size at the world centre, so the slotted child keeps its own
						   top/left:50% world origin unchanged. The handle frame below positions
						   itself at the child's bounding-box centre. */
						top: 50%;
						left: 50%;
						transform-style: preserve-3d;
						pointer-events: none;

						/* Handle frame placement + reach, read by .mirror and the bars/knobs. */
						--frame-x: ${handleCenterPx[0]}px;
						--frame-y: ${handleCenterPx[1]}px;
						--frame-z: ${handleCenterPx[2]}px;
						--len-x: ${handleLengthsPx[0]}px;
						--len-y: ${handleLengthsPx[1]}px;
						--len-z: ${handleLengthsPx[2]}px;

						/* Declared for the slotted child to pull (see the file header). */
						--carrier-live: ${carrierLive};
					}

					/* Handle frame: follows the child's bbox centre but NOT its rotation, so
					   the handles stay world-axis-aligned (never swing behind a block, and the
					   X/Y/Z handles line up with the world axes they drive). */
					.mirror {
						position: absolute;
						top: 50%;
						left: 50%;
						transform-style: preserve-3d;
						transform: translate3d(
							var(--frame-x, 0px),
							var(--frame-y, 0px),
							var(--frame-z, 0px)
						);
					}

					.handles {
						position: absolute;
						top: 50%;
						left: 50%;
						transform-style: preserve-3d;
					}
					/* Each axis container must keep its own 3D context. Without this the z
					   handle's translateZ/rotateY would be flattened onto the screen plane and
					   collapse back onto the origin — the "blue handle sits at the origin" bug. */
					.axis {
						transform-style: preserve-3d;
					}

					/* Each axis bar is a thin rod pivoting at the origin (transform-origin: left
					   center); its length tracks the child's extent so it always reaches its
					   knob, whatever the selection's size. */
					.bar {
						position: absolute;
						top: 50%;
						left: 50%;
						height: 3px;
						margin: -1.5px 0 0 0;
						transform-origin: left center;
					}
					.knob {
						position: absolute;
						top: 50%;
						left: 50%;
						width: 18px;
						height: 18px;
						margin: -9px 0 0 -9px;
						border-radius: 50%;
						border: 1px solid rgba(0, 0, 0, 0.4);
						pointer-events: auto;
						cursor: grab;
					}
					/* Knobs are flat discs; left as-is they vanish edge-on as the view turns.
					   Appending the inverse of the world's camera rotation (it applies
					   rotateX(-pitch) rotateY(-yaw)) makes each disc face the camera — a CSS
					   billboard, no JS per frame. The trailing translate is unaffected. */
					#origin {
						position: absolute;
						top: 50%;
						left: 50%;
						width: 12px;
						height: 12px;
						margin: -6px 0 0 -6px;
						border-radius: 50%;
						background: #f5f5f5;
						transform: rotateY(var(--camera-yaw, 0deg))
							rotateX(var(--camera-pitch, 0deg));
					}

					/* +x runs right: the bar needs no rotation (its left edge is the origin). */
					.axis-x .bar {
						width: var(--len-x, ${HANDLE_LENGTH}px);
						background: #ff5d5d;
					}
					.axis-x .knob {
						transform: translateX(var(--len-x, ${HANDLE_LENGTH}px))
							rotateY(var(--camera-yaw, 0deg)) rotateX(var(--camera-pitch, 0deg));
						background: #ff5d5d;
					}
					/* Author +Y is up; screen +Y is down, so the up handle points -y. */
					.axis-y .bar {
						width: var(--len-y, ${HANDLE_LENGTH}px);
						transform: rotateZ(-90deg);
						background: #62d562;
					}
					.axis-y .knob {
						transform: translateY(calc(-1 * var(--len-y, ${HANDLE_LENGTH}px)))
							rotateY(var(--camera-yaw, 0deg)) rotateX(var(--camera-pitch, 0deg));
						background: #62d562;
					}
					/* +z points toward the viewer. */
					.axis-z .bar {
						width: var(--len-z, ${HANDLE_LENGTH}px);
						transform: rotateY(-90deg);
						background: #5d9dff;
					}
					.axis-z .knob {
						transform: translateZ(var(--len-z, ${HANDLE_LENGTH}px))
							rotateY(var(--camera-yaw, 0deg)) rotateX(var(--camera-pitch, 0deg));
						background: #5d9dff;
					}
					.knob-yaw {
						position: absolute;
						top: 50%;
						left: 50%;
						width: 18px;
						height: 18px;
						margin: -9px 0 0 -9px;
						border-radius: 50%;
						border: 1px solid rgba(0, 0, 0, 0.4);
						background: #ffd95d;
						pointer-events: auto;
						cursor: grab;
						transform: translate3d(
								calc(var(--len-x, ${HANDLE_LENGTH}px) * 0.7),
								0,
								calc(var(--len-z, ${HANDLE_LENGTH}px) * 0.7)
							)
							rotateY(var(--camera-yaw, 0deg)) rotateX(var(--camera-pitch, 0deg));
					}

					/* The wrapped child must share our 3D context, so the slot must not
					   introduce a flattening box. */
					slot {
						display: contents;
					}
				</style>
				<div class="mirror">
					<div class="handles">
						<div id="origin"></div>
						<div class="axis axis-x">
							<div class="bar"></div>
							<div id="knob-x" class="knob" data-axis="x"></div>
						</div>
						<div class="axis axis-y">
							<div class="bar"></div>
							<div id="knob-y" class="knob" data-axis="y"></div>
						</div>
						<div class="axis axis-z">
							<div class="bar"></div>
							<div id="knob-z" class="knob" data-axis="z"></div>
						</div>
						<div class="knob-yaw" data-axis="yaw"></div>
					</div>
				</div>
				<slot></slot>
			`;
		};

		element.shadowRoot?.addEventListener("pointerdown", onHandleDown);

		return () => {
			element.shadowRoot?.removeEventListener("pointerdown", onHandleDown);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);
			// Torn down mid-drag (e.g. Escape while holding a knob, or the editor dropping
			// the selection): removing the gizmo removes the inherited --carrier-live, so the
			// child falls back to its committed transform on its own — nothing to clear here.
		};
	}),
);
