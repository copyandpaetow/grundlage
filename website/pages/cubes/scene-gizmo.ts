import { html, render } from "../../../lib/src";
import { UNIT_SIZE } from "./scene-shared";

// <scene-gizmo> — an editor-only overlay, never serialized. It carries its handle
// chrome in a shadow root so it stays out of exported markup, and it lives inside
// the world's 3D context (as a light-DOM child of <scene-world>) so it inherits
// the camera transform through preserve-3d and tracks the block it annotates with
// zero projection math on our side.
//
// The editor positions the gizmo by writing the block's translate3d onto the
// host. Each axis gets a draggable knob one unit out; the knob is tagged with
// `data-axis` so the editor can read which axis was grabbed straight off
// event.composedPath(). Drag projection is DOM-native: the editor samples the
// knobs' on-screen positions (already perspective-projected by the browser) via
// getHandlePoints(), so a pointer delta becomes a world delta with one dot
// product — no camera-matrix inversion, sidestepping CSS handedness entirely.

// How far each handle knob sits from the gizmo origin, in screen px (one unit).
const HANDLE_LENGTH = UNIT_SIZE;

// A 2D screen point. We hand these to the editor so it never has to reach across
// the shadow boundary to measure handles itself.
export type ScreenPoint = { x: number; y: number };
export type GizmoHandlePoints = {
	origin: ScreenPoint;
	x: ScreenPoint;
	y: ScreenPoint;
	z: ScreenPoint;
};

// The host gains this method so the editor can sample handle projections.
export type GizmoElement = HTMLElement & {
	getHandlePoints(): GizmoHandlePoints;
};

const centerOf = (rectangle: DOMRect): ScreenPoint => ({
	x: rectangle.left + rectangle.width / 2,
	y: rectangle.top + rectangle.height / 2,
});

customElements.define(
	"scene-gizmo",
	render(function* (element) {
		// The editor reads each axis knob's on-screen centre at drag start. These
		// are forced-layout reads, but only a handful and only once per drag start,
		// never per frame — well inside budget.
		(element as unknown as GizmoElement).getHandlePoints = (): GizmoHandlePoints => {
			const root = element.shadowRoot;
			const measure = (selector: string): ScreenPoint => {
				const node = root?.querySelector(selector) as HTMLElement | null;
				return node
					? centerOf(node.getBoundingClientRect())
					: { x: 0, y: 0 };
			};
			return {
				origin: measure("#origin"),
				x: measure("#knob-x"),
				y: measure("#knob-y"),
				z: measure("#knob-z"),
			};
		};

		yield html`
			<style>
				:host {
					position: absolute;
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					/* The gizmo body never swallows clicks meant for geometry; only
					   the handles below opt back into pointer events. */
					pointer-events: none;
				}

				.axis {
					position: absolute;
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
				}

				/* Each axis is a thin bar from the origin out to its knob. The bar is
				   centred then pushed half its length so it starts at the origin. */
				.bar {
					position: absolute;
					top: 50%;
					left: 50%;
					width: ${HANDLE_LENGTH}px;
					height: 3px;
					margin: -1.5px 0 0 0;
				}
				.knob {
					position: absolute;
					top: 50%;
					left: 50%;
					width: 16px;
					height: 16px;
					margin: -8px 0 0 -8px;
					border-radius: 50%;
					border: 1px solid rgba(0, 0, 0, 0.4);
					/* Handles are the only interactive part of the overlay. */
					pointer-events: auto;
					cursor: grab;
				}

				#origin {
					position: absolute;
					top: 50%;
					left: 50%;
					width: 12px;
					height: 12px;
					margin: -6px 0 0 -6px;
					border-radius: 50%;
					background: #f5f5f5;
				}

				/* +X points right. */
				.axis-x .bar {
					transform: translateX(${HANDLE_LENGTH / 2}px);
					background: #ff5d5d;
				}
				.axis-x .knob {
					transform: translateX(${HANDLE_LENGTH}px);
					background: #ff5d5d;
				}

				/* +Y points up; screen-space up is -Y. */
				.axis-y .bar {
					transform: rotateZ(90deg) translateX(${HANDLE_LENGTH / 2}px);
					background: #62d562;
				}
				.axis-y .knob {
					transform: translateY(${-HANDLE_LENGTH}px);
					background: #62d562;
				}

				/* +Z points toward the viewer. */
				.axis-z .bar {
					transform: rotateY(90deg) translateX(${-HANDLE_LENGTH / 2}px);
					background: #5d9dff;
				}
				.axis-z .knob {
					transform: translateZ(${HANDLE_LENGTH}px);
					background: #5d9dff;
				}

				/* Yaw handle: a knob offset into the X/Z quadrant. Dragging it
				   horizontally spins the block about Y. */
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
						${HANDLE_LENGTH * 0.7}px,
						0,
						${HANDLE_LENGTH * 0.7}px
					);
				}
			</style>
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
		`;
	}),
);
