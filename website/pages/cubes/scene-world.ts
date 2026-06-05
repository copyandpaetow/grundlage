import { html, render } from "../../../lib/src";
import type { CameraControls, SceneEditorElement } from "./scene-editor";
import "./scene-editor";
import "./wrappers/scene-gizmo";
import "./wrappers/scene-ghost";
import "./wrappers/scene-select";

// <scene-world> — owns the camera. It holds the perspective and the single
// inverse-camera wrapper transform the whole scene inherits through. Authored
// geometry is slotted in as light-DOM children, so the camera moves the entire
// world with one transform write and zero per-block work.
//
// The component is self-contained: the camera variables live on this element's
// own style (not the document root) and the cascade carries them into the shadow
// and across the slot. Nothing is written to document.head, so several worlds can
// coexist and the element drops cleanly.

type CameraState = {
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
};

// px advanced per animation frame while a movement key is held.
const MOVE_SPEED = 12;
// degrees of rotation per pixel of pointer movement while looking.
const LOOK_SENSITIVITY = 0.18;
const MAX_PITCH = 89;
// Keys that drive free-fly movement; anything else never starts the step loop.
const MOVEMENT_KEYS = new Set(["w", "a", "s", "d", " ", "shift"]);

customElements.define(
	"scene-world",
	render(function* (element) {
		const camera: CameraState = { x: 0, y: -160, z: 600, yaw: 0, pitch: 0 };
		const pressedKeys = new Set<string>();
		let animationFrame = 0;

		// Orbit is the constrained camera ("inspect the scene"): it pivots around a
		// fixed target instead of flying free. We keep the same yaw/pitch + inverse-
		// camera wrapper — only the camera position is derived. Target is the origin.
		const ORBIT_TARGET = { x: 0, y: 0, z: 0 };
		let cameraMode: "free" | "orbit" = "free";
		let orbitRadius = 600;

		// The only place camera state reaches CSS, and it is write-only (no layout
		// read), so there is no forced synchronous layout. Variables land on this
		// element, not the document root, so the component stays self-contained.
		const writeCamera = (): void => {
			const style = element.style;
			style.setProperty("--camera-x", `${camera.x}px`);
			style.setProperty("--camera-y", `${camera.y}px`);
			style.setProperty("--camera-z", `${camera.z}px`);
			style.setProperty("--camera-yaw", `${camera.yaw}deg`);
			style.setProperty("--camera-pitch", `${camera.pitch}deg`);
		};

		// World basis derived from yaw. The wrapper applies rotateY(-yaw), so the
		// camera's actual forward is rotateY(yaw)·(0,0,-1) = (-sin, 0, -cos) and its
		// right is rotateY(yaw)·(1,0,0) = (cos, 0, -sin). Getting these signs to
		// agree with the wrapper is exactly what keeps WASD from inverting after a
		// turn (the failure the plan warns about).
		const basis = (): {
			forward: [number, number];
			right: [number, number];
		} => {
			const yawRadians = (camera.yaw * Math.PI) / 180;
			return {
				forward: [-Math.sin(yawRadians), -Math.cos(yawRadians)],
				right: [Math.cos(yawRadians), -Math.sin(yawRadians)],
			};
		};

		// Sit the camera one radius behind the orbit target along the view
		// direction, so it always faces the target.
		const applyOrbit = (): void => {
			const yawRadians = (camera.yaw * Math.PI) / 180;
			const pitchRadians = (camera.pitch * Math.PI) / 180;
			const forwardX = -Math.sin(yawRadians) * Math.cos(pitchRadians);
			const forwardY = Math.sin(pitchRadians);
			const forwardZ = -Math.cos(yawRadians) * Math.cos(pitchRadians);
			camera.x = ORBIT_TARGET.x - orbitRadius * forwardX;
			camera.y = ORBIT_TARGET.y - orbitRadius * forwardY;
			camera.z = ORBIT_TARGET.z - orbitRadius * forwardZ;
		};

		// Free-fly: translate along the heading derived from yaw, so "forward"
		// follows where we look. Runs only while a movement key is held.
		const step = (): void => {
			if (cameraMode === "free") {
				const { forward, right } = basis();
				if (pressedKeys.has("w")) {
					camera.x += MOVE_SPEED * forward[0];
					camera.z += MOVE_SPEED * forward[1];
				}
				if (pressedKeys.has("s")) {
					camera.x -= MOVE_SPEED * forward[0];
					camera.z -= MOVE_SPEED * forward[1];
				}
				if (pressedKeys.has("d")) {
					camera.x += MOVE_SPEED * right[0];
					camera.z += MOVE_SPEED * right[1];
				}
				if (pressedKeys.has("a")) {
					camera.x -= MOVE_SPEED * right[0];
					camera.z -= MOVE_SPEED * right[1];
				}
				// Screen-space +Y is down, so moving the camera up decreases Y.
				if (pressedKeys.has(" ")) camera.y -= MOVE_SPEED;
				if (pressedKeys.has("shift")) camera.y += MOVE_SPEED;
			}

			writeCamera();
			animationFrame = pressedKeys.size > 0 ? requestAnimationFrame(step) : 0;
		};

		const startStepping = (): void => {
			if (animationFrame === 0) animationFrame = requestAnimationFrame(step);
		};

		const onKeyDown = (event: KeyboardEvent): void => {
			// Don't hijack typing in the editor's inputs (e.g. size fields). The
			// inputs live in shadow DOM, so event.target is retargeted to the host at
			// window scope — composedPath()[0] is the real target.
			if (event.composedPath()[0] instanceof HTMLInputElement) return;
			const key = event.key.toLowerCase();
			if (!MOVEMENT_KEYS.has(key)) return;
			pressedKeys.add(key);
			startStepping();
		};

		const onKeyUp = (event: KeyboardEvent): void => {
			pressedKeys.delete(event.key.toLowerCase());
		};

		// The editor drives the camera through this plain object — passed as a
		// parameter rather than bolted onto the element — so pointer handling lives
		// in one place and we never monkey-patch the DOM node.
		const cameraControls: CameraControls = {
			applyLook(deltaX, deltaY) {
				// Drag right looks right (yaw decreases to face +X under rotateY(-yaw));
				// drag down looks down.
				camera.yaw -= deltaX * LOOK_SENSITIVITY;
				camera.pitch = Math.max(
					-MAX_PITCH,
					Math.min(MAX_PITCH, camera.pitch + deltaY * LOOK_SENSITIVITY),
				);
				if (cameraMode === "orbit") applyOrbit();
				writeCamera();
			},
			zoom(delta) {
				if (cameraMode !== "orbit") return false;
				orbitRadius = Math.max(120, Math.min(4000, orbitRadius + delta));
				applyOrbit();
				writeCamera();
				return true;
			},
			toggleMode() {
				if (cameraMode === "free") {
					cameraMode = "orbit";
					orbitRadius =
						Math.hypot(
							camera.x - ORBIT_TARGET.x,
							camera.y - ORBIT_TARGET.y,
							camera.z - ORBIT_TARGET.z,
						) || orbitRadius;
					applyOrbit();
					writeCamera();
					return "Orbit";
				}
				cameraMode = "free";
				return "Free";
			},
		};

		yield html`
			<style>
				:host {
					display: block;
					position: relative;
					width: 100%;
					height: 70vh;
					overflow: hidden;
					border: 1px solid rgba(255, 255, 255, 0.12);
					border-radius: 12px;
					background: radial-gradient(circle at 50% 30%, #2a2f3a, #14161c);
					cursor: default;
					/* Selecting text would fight every click-drag, so opt the whole
					   scene out of selection. */
					user-select: none;
					-webkit-user-select: none;
					perspective: var(--camera-perspective);
					perspective-origin: 50% 50%;

					/* Self-contained camera defaults: the cascade carries these into
					   the shadow and across the slot. JS overwrites them per frame. */
					--camera-perspective: 800px;
					--camera-x: 0px;
					--camera-y: 0px;
					--camera-z: 600px;
					--camera-yaw: 0deg;
					--camera-pitch: 0deg;
				}

				.world {
					position: absolute;
					inset: 0;
					transform-style: preserve-3d;
					transform-origin: 50% 50%;
					/* The flat world sheet must never intercept clicks, or it would
					   shadow every block sitting behind it (the "can't click the back
					   half" bug). Geometry faces opt back into pointer events. */
					pointer-events: none;
					/* Inverse-camera transform. The leading translateZ(perspective)
					   lands the camera point on the eye so yaw/pitch rotate the view in
					   place. One write here moves everything. */
					transform: translateZ(var(--camera-perspective))
						rotateX(calc(var(--camera-pitch) * -1))
						rotateY(calc(var(--camera-yaw) * -1))
						translate3d(
							calc(var(--camera-x) * -1),
							calc(var(--camera-y) * -1),
							calc(var(--camera-z) * -1)
						);
				}

				/* Slotted geometry must share the world's 3D context, so the slot
				   itself must not introduce a flattening box. */
				slot {
					display: contents;
				}
			</style>
			<div class="world"><slot></slot></div>
		`;

		// The shadow content now exists, so wire up interactivity and mount the editor
		// into our shadow, where it hosts its chrome and adds overlays to our light DOM.
		// This all sits after the first yield, which the lib reaches only on the client:
		// on the server it stops the generator at that yield, so nothing here runs and the
		// server emits just the static scene markup.
		writeCamera();
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		const editor = document.createElement("scene-editor") as SceneEditorElement;
		editor.sceneHost = element;
		editor.camera = cameraControls;
		element.shadowRoot?.appendChild(editor);

		// Generator return = teardown. The lib fires this on disconnect — client-only,
		// since on the server the generator never steps past the yield to reach here.
		return () => {
			if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
			editor.remove();
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
		};
	}),
);
