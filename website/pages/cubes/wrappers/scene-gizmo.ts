import { html, component } from "../../../../lib/src";
import {
	sceneElementRendered,
	formatNumber,
	registerProperties,
	UNIT_SIZE,
	type Vector3,
} from "../scene-shared";
import { blocksBoundsPx, eulerFromMatrix, fromScreenPoint } from "../scene-geometry";

// The drag in flight moves the child inside the gizmo's own carrier, so its attributes
// change once, on drop, and the gizmo works on any child.

// Every value is bound on the element that reads it: WebKit never re-resolves a value pulled
// down with `inherit` when the parent's changes. The drag's are non-inheriting, so a drag
// frame never restyles the dragged blocks; only the handles' lengths and the camera turn
// inherit, from .mirror into the handles alone.
registerProperties([
	...["x", "y", "z", "yaw"].map((axis) => ({
		name: `--drag-${axis}`,
		syntax: "<number>",
		inherits: false,
		initialValue: "0",
	})),
	...["frame-x", "frame-y", "frame-z"].map((name) => ({
		name: `--${name}`,
		syntax: "<length>",
		inherits: false,
		initialValue: "0px",
	})),
	...["handle-length-x", "handle-length-y", "handle-length-z"].map((name) => ({
		name: `--${name}`,
		syntax: "<length>",
		inherits: true,
		initialValue: "0px",
	})),
	...["handle-camera-yaw", "handle-camera-pitch"].map((name) => ({
		name: `--${name}`,
		syntax: "<angle>",
		inherits: true,
		initialValue: "0deg",
	})),
	{
		name: "--drag-slide",
		syntax: "<transform-list>",
		inherits: false,
		initialValue: "translateX(0px)",
	},
]);

const HANDLE_LENGTH = UNIT_SIZE;
const YAW_PER_PIXEL = 0.5;
// Screen px a knob sits beyond the child's box, so handles clear the cage at any size.
const HANDLE_MARGIN = 44;

type ScreenPoint = { x: number; y: number };
type DragMode = "x" | "y" | "z" | "yaw";

const axisIndexOf = (mode: DragMode): number => {
	if (mode === "x") return 0;
	if (mode === "y") return 1;
	return 2;
};

const dot = (a: ScreenPoint, b: ScreenPoint): number => a.x * b.x + a.y * b.y;

const centerOf = (rectangle: DOMRect): ScreenPoint => ({
	x: rectangle.left + rectangle.width / 2,
	y: rectangle.top + rectangle.height / 2,
});

const gizmoStyles = html`
	<style>
		:host {
			position: absolute;
			/* Zero size at the world centre, so the slotted child keeps its own
			   top/left:50% world origin. */
			top: 50%;
			left: 50%;
			transform-style: preserve-3d;
			pointer-events: none;
		}

		.mirror,
		.carrier {
			/* Author +Y is up, screen +Y is down */
			--drag-slide: translate3d(
				calc(var(--drag-x) * var(--unit)),
				calc(var(--drag-y) * var(--unit) * -1),
				calc(var(--drag-z) * var(--unit))
			);
		}

		/* Zero size at the gizmo's origin, like the gizmo itself, so the child keeps its
		   world origin */
		.carrier {
			position: absolute;
			transform-style: preserve-3d;
			transform: translate3d(var(--frame-x), var(--frame-y), var(--frame-z))
				rotateY(calc(var(--drag-yaw) * 1deg))
				translate3d(
					calc(var(--frame-x) * -1),
					calc(var(--frame-y) * -1),
					calc(var(--frame-z) * -1)
				)
				var(--drag-slide);
		}

		/* Follows the child's box centre and its slide but NOT its rotation, so the
		   handles stay world-axis-aligned. */
		.mirror {
			position: absolute;
			top: 50%;
			left: 50%;
			transform-style: preserve-3d;
			transform: var(--drag-slide)
				translate3d(var(--frame-x), var(--frame-y), var(--frame-z));
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
		/* Knobs are flat discs and would vanish edge-on as the view turns. The world
		   turns by Rx(-pitch)·Ry(-yaw), so appending its inverse Ry(yaw)·Rx(pitch)
		   faces each knob to the camera: a CSS billboard. */
		#origin {
			position: absolute;
			top: 50%;
			left: 50%;
			width: 12px;
			height: 12px;
			margin: -6px 0 0 -6px;
			border-radius: 50%;
			background: #f5f5f5;
			transform: rotateY(var(--handle-camera-yaw))
				rotateX(var(--handle-camera-pitch));
		}

		.axis-x .bar {
			width: var(--handle-length-x);
			background: #ff5d5d;
		}
		.axis-x .knob {
			transform: translateX(var(--handle-length-x))
				rotateY(var(--handle-camera-yaw)) rotateX(var(--handle-camera-pitch));
			background: #ff5d5d;
		}
		/* Author +Y is up and screen +Y is down, so the up handle points -y. */
		.axis-y .bar {
			width: var(--handle-length-y);
			transform: rotateZ(-90deg);
			background: #62d562;
		}
		.axis-y .knob {
			transform: translateY(calc(-1 * var(--handle-length-y)))
				rotateY(var(--handle-camera-yaw)) rotateX(var(--handle-camera-pitch));
			background: #62d562;
		}
		.axis-z .bar {
			width: var(--handle-length-z);
			transform: rotateY(-90deg);
			background: #5d9dff;
		}
		.axis-z .knob {
			transform: translateZ(var(--handle-length-z))
				rotateY(var(--handle-camera-yaw)) rotateX(var(--handle-camera-pitch));
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
					calc(var(--handle-length-x) * 0.7),
					0,
					calc(var(--handle-length-z) * 0.7)
				)
				rotateY(var(--handle-camera-yaw)) rotateX(var(--handle-camera-pitch));
		}

		/* A flattening box here would collapse the child's preserve-3d. */
		slot {
			display: contents;
		}
	</style>
`;

customElements.define(
	"scene-gizmo",
	component(function* ({ host: element }) {
		let handleCenterPx: Vector3 = [0, 0, 0];
		let handleLengthsPx: Vector3 = [HANDLE_LENGTH, HANDLE_LENGTH, HANDLE_LENGTH];

		let drag: {
			mode: DragMode;
			axisIndex: number;
			startPointer: ScreenPoint;
			screenOffsetPerWorldUnit: ScreenPoint;
			target: HTMLElement;
			unitsAlongAxis: number;
			yawDegrees: number;
		} | null = null;

		// Copied once per turn, not forwarded by every block each frame. A world without the
		// attributes shows its default turn of 0deg.
		const world = element.closest<HTMLElement>("scene-world");
		let cameraYaw = "0deg";
		let cameraPitch = "0deg";
		const readCameraTurn = (): void => {
			if (world === null) return;
			cameraYaw = world.getAttribute("camera-yaw") ?? "0deg";
			cameraPitch = world.getAttribute("camera-pitch") ?? "0deg";
		};
		readCameraTurn();
		const cameraTurnObserver = new MutationObserver(() => {
			readCameraTurn();
			void element.update();
		});
		if (world !== null) {
			cameraTurnObserver.observe(world, {
				attributes: true,
				attributeFilter: ["camera-yaw", "camera-pitch"],
			});
		}

		const child = (): HTMLElement | null => {
			const slot = element.shadowRoot?.querySelector("slot");
			const assigned = (slot?.assignedElements() ?? [])[0];
			return assigned instanceof HTMLElement ? assigned : null;
		};

		const handlePoint = (selector: string): ScreenPoint => {
			const node = element.shadowRoot?.querySelector(selector) as HTMLElement | null;
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
				active.yawDegrees = delta.x * YAW_PER_PIXEL;
			} else {
				// Scalar projection: (delta · a) / (a · a), with a = one world unit on screen
				const lengthSquared = dot(active.screenOffsetPerWorldUnit, active.screenOffsetPerWorldUnit);
				active.unitsAlongAxis =
					lengthSquared === 0 ? 0 : dot(delta, active.screenOffsetPerWorldUnit) / lengthSquared;
			}
			void element.update();
		};

		const commitDrag = (): void => {
			if (drag === null) return;
			const target = drag.target;
			const carrier = element.shadowRoot?.querySelector(".carrier");
			if (carrier === null || carrier === undefined) {
				throw new Error("The gizmo dropped a drag before rendering its carrier.");
			}
			// The child's placement in the gizmo's frame: carrier · placement
			const matrix = new DOMMatrix(getComputedStyle(carrier).transform).multiply(
				new DOMMatrix(getComputedStyle(target).transform),
			);
			// Unsnapped: the editor snaps the leaf blocks on flatten, and snapping this
			// carrier too would add a grid-sized jump, worst after an off-centre yaw.
			const position = fromScreenPoint(new DOMPoint(matrix.m41, matrix.m42, matrix.m43));
			const rotation = eulerFromMatrix(matrix);
			target.setAttribute("position", position.map(formatNumber).join(" "));
			target.setAttribute("rotation", rotation.map(formatNumber).join(" "));
			target.removeAttribute("x");
			target.removeAttribute("y");
			target.removeAttribute("z");

			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);

			// The drag clears only after the child re-rendered from its new attributes, so
			// both transforms agree for one frame and nothing flashes.
			const settledChild = sceneElementRendered(target);
			drag = null;
			void settledChild.then(() => {
				void element.update();
				element.dispatchEvent(new CustomEvent("scene-commit", { bubbles: true }));
			});
		};

		const onHandleDown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			const target = child();
			if (target === null) return;
			const handle = (event.target as HTMLElement)?.closest("[data-axis]");
			if (!(handle instanceof HTMLElement)) return;
			const mode = handle.dataset.axis as DragMode;
			// The editor would read this as a select or deselect
			event.preventDefault();
			event.stopPropagation();

			const axisIndex = axisIndexOf(mode);
			let screenOffsetPerWorldUnit: ScreenPoint = { x: 0, y: 0 };
			if (mode !== "yaw") {
				const origin = handlePoint("#origin");
				const tip = handlePoint(`#knob-${mode}`);
				// Measured on screen, so no camera matrix is needed
				const worldUnitsOut = handleLengthsPx[axisIndex] / UNIT_SIZE;
				const scale = worldUnitsOut === 0 ? 0 : 1 / worldUnitsOut;
				screenOffsetPerWorldUnit = {
					x: (tip.x - origin.x) * scale,
					y: (tip.y - origin.y) * scale,
				};
			}
			drag = {
				mode,
				axisIndex,
				startPointer: { x: event.clientX, y: event.clientY },
				screenOffsetPerWorldUnit,
				target,
				unitsAlongAxis: 0,
				yawDegrees: 0,
			};
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", commitDrag);
		};

		const unitsAlong = (axisIndex: number): number =>
			drag !== null && drag.mode !== "yaw" && drag.axisIndex === axisIndex
				? drag.unitsAlongAxis
				: 0;

		yield function* view() {
			// The frame is the drag's pivot, so it holds still while a drag is in flight.
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
			}

			const dragVariables = `--frame-x: ${handleCenterPx[0]}px; --frame-y: ${handleCenterPx[1]}px; --frame-z: ${handleCenterPx[2]}px; --drag-x: ${unitsAlong(0)}; --drag-y: ${unitsAlong(1)}; --drag-z: ${unitsAlong(2)}; --drag-yaw: ${drag?.yawDegrees ?? 0};`;

			yield html`
				${gizmoStyles}
				<div
					class="mirror"
					style="${dragVariables} --handle-length-x: ${handleLengthsPx[0]}px; --handle-length-y: ${handleLengthsPx[1]}px; --handle-length-z: ${handleLengthsPx[2]}px; --handle-camera-yaw: ${cameraYaw}; --handle-camera-pitch: ${cameraPitch};"
				>
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
				<div class="carrier" style=${dragVariables}><slot></slot></div>
			`;
		};

		// Torn down mid-drag, the child leaves the carrier and falls back on its own placement
		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);
			cameraTurnObserver.disconnect();
		};
	}),
);
