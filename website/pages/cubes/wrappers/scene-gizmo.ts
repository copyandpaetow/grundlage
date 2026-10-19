import { html, component } from "../../../../lib/src";
import {
	sceneElementRendered,
	blocksBoundsPx,
	blockTransformFromAttributes,
	eulerFromMatrix,
	formatNumber,
	frameMatrix,
	fromScreenPoint,
	UNIT_SIZE,
	type Vector3,
} from "../scene-shared";

// <scene-gizmo> — the manipulation knobs, and nothing else. A GENERIC transform tool: it
// reads and writes the transform of its ONE direct child and never looks past it. Block,
// group or <scene-select> cage, they are all the same to it, because every carrier honours
// the same contract: authored position/rotation for the committed value, an inherited
// --carrier-live for the in-flight one.
//
// A drag is a SINGLE matrix and everything about it is declarative:
//   live: we DECLARE --carrier-live on our host. It inherits across the slot to the child,
//     whose :host pulls it, so the child and whatever it wraps ride the drag as one rigid
//     body — pure CSS inheritance, no JS touching the child, nothing measured per frame.
//   drop: we write the child's authored attributes, clear --carrier-live once the child
//     has re-rendered against them (so the committed transform already equals the live one
//     and nothing flashes), and bubble `scene-commit`. The editor then flattens the child's
//     transform into the leaf blocks; the gizmo neither knows nor cares.
//
// The handle frame follows the child's bounding-box centre but never its rotation, so the
// handles never swing behind a turned block and the X/Y/Z handles line up with the world
// axes they drive. Drag projection is the one genuinely DOM-dependent read: we measure our
// own knobs, already perspective-projected by the browser, and turn a pointer delta into
// world units with one dot product — no camera matrix.

const HANDLE_LENGTH = UNIT_SIZE;
const YAW_PER_PIXEL = 0.5;
// Screen px a knob sits beyond the child's box, so handles clear the cage at any size.
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
	component(function* ({ host: element }) {
		// Where the knobs sit (the child's box centre) and how far each axis reaches. A
		// non-drag render re-measures them from the child; a drag render derives the centre
		// from the gesture instead.
		let handleCenterPx: Vector3 = [0, 0, 0];
		let handleLengthsPx: Vector3 = [
			HANDLE_LENGTH,
			HANDLE_LENGTH,
			HANDLE_LENGTH,
		];

		let drag: {
			mode: DragMode;
			axisIndex: number;
			startPointer: ScreenPoint;
			// Screen displacement for ONE world unit along the dragged axis.
			axisScreen: ScreenPoint;
			target: HTMLElement;
			// The child's transform when the drag began, in screen-px world space.
			startMatrix: DOMMatrix;
			startCenterPx: Vector3;
			// What the latest move produced: read straight from here by the render
			// (--carrier-live) and by the commit (the authored attributes).
			liveMatrix: DOMMatrix;
			centerPx: Vector3;
		} | null = null;

		const child = (): HTMLElement | null => {
			const slot = element.shadowRoot?.querySelector("slot");
			const assigned = (slot?.assignedElements() ?? [])[0];
			return assigned instanceof HTMLElement ? assigned : null;
		};

		const childMatrix = (target: HTMLElement): DOMMatrix => {
			const { position, rotation } = blockTransformFromAttributes(target);
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
				// Rotate the whole child about its box centre: a pivot matrix premultiplied
				// onto the start transform. For a cage that orbits and spins every block as
				// one rigid body; for a lone block it is a spin in place.
				const degrees = delta.x * YAW_PER_PIXEL;
				const [centerX, centerY, centerZ] = active.startCenterPx;
				const pivot = new DOMMatrix(
					`translate3d(${centerX}px, ${centerY}px, ${centerZ}px) rotateY(${degrees}deg) translate3d(${-centerX}px, ${-centerY}px, ${-centerZ}px)`,
				);
				active.liveMatrix = pivot.multiply(active.startMatrix);
				// The pivot is fixed under its own rotation, so the handle frame stays put.
				active.centerPx = active.startCenterPx;
			} else {
				const lengthSquared = dot(active.axisScreen, active.axisScreen);
				const units =
					lengthSquared === 0
						? 0
						: dot(delta, active.axisScreen) / lengthSquared;
				const offsetPx = units * UNIT_SIZE;
				// World axis → world-CSS-px direction (author +Y up is screen −Y).
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
				active.centerPx = addPx(active.startCenterPx, translatePx);
			}
			// One channel: the move changed our state, so re-render. The child rides the
			// new --carrier-live by inheritance; the handles re-pin to active.centerPx.
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
			// jump, worst for a yaw whose off-origin pivot puts a large translation in the
			// matrix. Grid snapping is the editor's job, not this generic tool's.
			const position = fromScreenPoint(
				new DOMPoint(matrix.m41, matrix.m42, matrix.m43),
			);
			const rotation = eulerFromMatrix(matrix);
			target.setAttribute("position", position.map(formatNumber).join(" "));
			target.setAttribute("rotation", rotation.map(formatNumber).join(" "));
			target.removeAttribute("x");
			target.removeAttribute("y");
			target.removeAttribute("z");

			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);

			// --carrier-live still holds the dragged matrix from our last render, so the
			// child has not moved. Once it has re-rendered from its new attributes its
			// committed transform equals the live one, so dropping the drag and re-rendering
			// clears the override with no flash. Then tell the editor it can flatten.
			const settledChild = sceneElementRendered(target);
			drag = null;
			void settledChild.then(() => {
				void element.update();
				element.dispatchEvent(
					new CustomEvent("scene-commit", { bubbles: true }),
				);
			});
		};

		const onHandleDown = (event: PointerEvent): void => {
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
				// The knob sits handleLengthsPx / UNIT_SIZE world units out; scaling its
				// screen offset down to one world unit makes the dot product below yield
				// world units directly.
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

		yield function* view() {
			if (drag === null) {
				const target = child();
				const bounds = blocksBoundsPx(target === null ? [] : [target]);
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
			// Unset while idle, so the child's var() falls back to its committed transform.
			const carrierLive =
				drag === null ? "initial" : (drag.liveMatrix.toString() as string);

			yield html`
				<style>
					:host {
						position: absolute;
						/* Zero size at the world centre, so the slotted child keeps its own
						   top/left:50% world origin. */
						top: 50%;
						left: 50%;
						transform-style: preserve-3d;
						pointer-events: none;

						--frame-x: ${handleCenterPx[0]}px;
						--frame-y: ${handleCenterPx[1]}px;
						--frame-z: ${handleCenterPx[2]}px;
						--len-x: ${handleLengthsPx[0]}px;
						--len-y: ${handleLengthsPx[1]}px;
						--len-z: ${handleLengthsPx[2]}px;

						/* Declared for the slotted child to pull; see the file header. */
						--carrier-live: ${carrierLive};
					}

					/* Follows the child's box centre but NOT its rotation, so the handles stay
					   world-axis-aligned. */
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
					/* Without its own 3D context the z handle's translateZ/rotateY flattens
					   onto the screen plane and collapses back onto the origin. */
					.axis {
						transform-style: preserve-3d;
					}

					/* A thin rod pivoting at the origin; its length tracks the child's extent
					   so it always reaches its knob. */
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
					/* Knobs are flat discs and would vanish edge-on as the view turns.
					   Appending the inverse of the world's camera rotation makes each face the
					   camera: a CSS billboard, no JS per frame. */
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

					/* +x runs right, so the bar needs no rotation. */
					.axis-x .bar {
						width: var(--len-x, ${HANDLE_LENGTH}px);
						background: #ff5d5d;
					}
					.axis-x .knob {
						transform: translateX(var(--len-x, ${HANDLE_LENGTH}px))
							rotateY(var(--camera-yaw, 0deg))
							rotateX(var(--camera-pitch, 0deg));
						background: #ff5d5d;
					}
					/* Author +Y is up and screen +Y is down, so the up handle points -y. */
					.axis-y .bar {
						width: var(--len-y, ${HANDLE_LENGTH}px);
						transform: rotateZ(-90deg);
						background: #62d562;
					}
					.axis-y .knob {
						transform: translateY(calc(-1 * var(--len-y, ${HANDLE_LENGTH}px)))
							rotateY(var(--camera-yaw, 0deg))
							rotateX(var(--camera-pitch, 0deg));
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
							rotateY(var(--camera-yaw, 0deg))
							rotateX(var(--camera-pitch, 0deg));
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
							rotateY(var(--camera-yaw, 0deg))
							rotateX(var(--camera-pitch, 0deg));
					}

					/* A flattening box here would collapse the child's preserve-3d. */
					slot {
						display: contents;
					}
				</style>
				<div class="mirror">
					<div class="handles" onPointerDown=${onHandleDown}>
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

		// Torn down mid-drag, removing the gizmo removes the inherited --carrier-live, so
		// the child falls back to its committed transform on its own.
		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);
		};
	}),
);
