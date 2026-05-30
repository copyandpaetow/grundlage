import { html, render } from "../../../lib/src";
import { installCameraProperties } from "./scene-shared";
import { installEditor } from "./scene-editor";
import "./scene-gizmo";

// <scene-world> — owns the camera. It holds the perspective and the single
// inverse-camera wrapper transform the whole scene inherits through. Authored
// geometry is slotted in as light-DOM children, so the camera moves the entire
// world with one transform write and zero per-block work.

// Camera state is in-flight render state, not authored DOM, so it lives here in
// JS and is mirrored onto the document root's CSS variables. The cascade does
// the rest — no per-frame JS while the camera is still.
type CameraState = {
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
};

// px advanced per animation frame while a movement key is held.
const MOVE_SPEED = 12;
// degrees of rotation per pixel of pointer movement under pointer lock.
const LOOK_SENSITIVITY = 0.12;
const MAX_PITCH = 89;

customElements.define(
	"scene-world",
	render(function* (element) {
		installCameraProperties();

		const camera: CameraState = { x: 0, y: -160, z: 600, yaw: 0, pitch: 0 };
		const pressedKeys = new Set<string>();
		let animationFrame = 0;

		// The only place camera state reaches CSS. Write-only: we never read a
		// layout property here, so there is no forced synchronous layout.
		const writeCamera = (): void => {
			const rootStyle = document.documentElement.style;
			rootStyle.setProperty("--camera-x", `${camera.x}px`);
			rootStyle.setProperty("--camera-y", `${camera.y}px`);
			rootStyle.setProperty("--camera-z", `${camera.z}px`);
			rootStyle.setProperty("--camera-yaw", `${camera.yaw}deg`);
			rootStyle.setProperty("--camera-pitch", `${camera.pitch}deg`);
		};

		// Orbit is the constrained camera ("inspect this block"): it pivots around a
		// fixed target instead of flying free. We keep the same yaw/pitch/inverse-
		// camera wrapper — only the camera position is derived, so the cascade and
		// the world transform are untouched. Target is the scene origin for now.
		const ORBIT_TARGET = { x: 0, y: 0, z: 0 };
		let cameraMode: "free" | "orbit" = "free";
		let orbitRadius = 600;

		// View direction from yaw/pitch, matching the wrapper's rotateX/rotateY.
		// Forward is -Z at the origin; screen-space +Y (down) is positive pitch.
		const orbitForward = (): { x: number; y: number; z: number } => {
			const yawRadians = (camera.yaw * Math.PI) / 180;
			const pitchRadians = (camera.pitch * Math.PI) / 180;
			return {
				x: Math.sin(yawRadians) * Math.cos(pitchRadians),
				y: Math.sin(pitchRadians),
				z: -Math.cos(yawRadians) * Math.cos(pitchRadians),
			};
		};

		// Sit the camera one radius behind the target along the view direction, so
		// it always looks at the target.
		const applyOrbit = (): void => {
			const forward = orbitForward();
			camera.x = ORBIT_TARGET.x - orbitRadius * forward.x;
			camera.y = ORBIT_TARGET.y - orbitRadius * forward.y;
			camera.z = ORBIT_TARGET.z - orbitRadius * forward.z;
		};

		// Free-fly: we translate along the heading derived from yaw, so "forward"
		// always follows where we look. Forward is -Z at yaw 0. This runs only
		// while a movement key is held, so a still camera does no frame work.
		const step = (): void => {
			// In orbit mode the camera position is derived from the target, not the
			// keys; WASD is a free-fly gesture only.
			if (cameraMode === "free") {
			const yawRadians = (camera.yaw * Math.PI) / 180;
			const forwardX = Math.sin(yawRadians);
			const forwardZ = -Math.cos(yawRadians);
			const rightX = Math.cos(yawRadians);
			const rightZ = Math.sin(yawRadians);

			if (pressedKeys.has("w")) {
				camera.x += MOVE_SPEED * forwardX;
				camera.z += MOVE_SPEED * forwardZ;
			}
			if (pressedKeys.has("s")) {
				camera.x -= MOVE_SPEED * forwardX;
				camera.z -= MOVE_SPEED * forwardZ;
			}
			if (pressedKeys.has("d")) {
				camera.x += MOVE_SPEED * rightX;
				camera.z += MOVE_SPEED * rightZ;
			}
			if (pressedKeys.has("a")) {
				camera.x -= MOVE_SPEED * rightX;
				camera.z -= MOVE_SPEED * rightZ;
			}
			// Screen-space +Y is down, so moving the camera up decreases Y.
			if (pressedKeys.has(" ")) camera.y -= MOVE_SPEED;
			if (pressedKeys.has("shift")) camera.y += MOVE_SPEED;
			}

			writeCamera();
			animationFrame =
				pressedKeys.size > 0 ? requestAnimationFrame(step) : 0;
		};

		const startStepping = (): void => {
			if (animationFrame === 0) animationFrame = requestAnimationFrame(step);
		};

		const onKeyDown = (event: KeyboardEvent): void => {
			pressedKeys.add(event.key.toLowerCase());
			startStepping();
		};

		const onKeyUp = (event: KeyboardEvent): void => {
			pressedKeys.delete(event.key.toLowerCase());
		};

		// Mouse-look is event-driven and bound to the right button, leaving the
		// left button free for editing (select/drag). We adjust orientation only
		// while the right button is held and the pointer actually moves — a still
		// camera does no frame work.
		let looking = false;

		const onPointerDown = (event: PointerEvent): void => {
			if (event.button !== 2) return;
			looking = true;
		};

		const onPointerMove = (event: PointerEvent): void => {
			if (!looking) return;
			camera.yaw += event.movementX * LOOK_SENSITIVITY;
			camera.pitch = Math.max(
				-MAX_PITCH,
				Math.min(MAX_PITCH, camera.pitch + event.movementY * LOOK_SENSITIVITY),
			);
			// Free-fly turns in place; orbit re-derives the position so the look
			// gesture sweeps the camera around the target.
			if (cameraMode === "orbit") applyOrbit();
			writeCamera();
		};

		const onPointerUp = (event: PointerEvent): void => {
			if (event.button === 2) looking = false;
		};

		// Right-drag is our look gesture, so suppress the context menu over the
		// scene; without this the menu interrupts every turn.
		const onContextMenu = (event: Event): void => event.preventDefault();

		// The wheel dollies the orbit radius in/out (orbit mode only).
		const onWheel = (event: WheelEvent): void => {
			if (cameraMode !== "orbit") return;
			event.preventDefault();
			orbitRadius = Math.max(120, Math.min(4000, orbitRadius + event.deltaY));
			applyOrbit();
			writeCamera();
		};

		// The editor's palette flips the mode through this. Entering orbit keeps the
		// current gaze but pins the radius to the present distance from the target,
		// so the view doesn't jump.
		type CameraControl = { toggleCameraMode?: () => string };
		(element as unknown as CameraControl).toggleCameraMode = (): string => {
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
		};

		// Listeners, the editor, and the initial camera write are client-only; on
		// the server the generator still produces the static markup without them.
		let disposeEditor: (() => void) | undefined;
		if (typeof window !== "undefined") {
			writeCamera();
			window.addEventListener("keydown", onKeyDown);
			window.addEventListener("keyup", onKeyUp);
			window.addEventListener("pointermove", onPointerMove);
			element.addEventListener("pointerdown", onPointerDown);
			window.addEventListener("pointerup", onPointerUp);
			element.addEventListener("contextmenu", onContextMenu);
			element.addEventListener("wheel", onWheel, { passive: false });
		}

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
					perspective: var(--camera-perspective);
					perspective-origin: 50% 50%;
				}
				.world {
					position: absolute;
					inset: 0;
					transform-style: preserve-3d;
					transform-origin: 50% 50%;
					/* Inverse-camera transform. The leading
					   translateZ(perspective) lands the camera point on the eye so
					   yaw/pitch rotate the view in place (first-person look-around)
					   instead of orbiting the scene. The rest undoes the camera's
					   orientation and position. One write here moves everything. */
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

		// The shadow content now exists, so the editor can host its palette in our
		// shadow and add its gizmo to our light DOM. Client-only: the server emits
		// just the static scene markup.
		if (typeof window !== "undefined") {
			disposeEditor = installEditor(element);
		}

		// Generator return = teardown. The lib fires this on disconnect.
		return () => {
			if (typeof window === "undefined") return;
			if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
			disposeEditor?.();
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("pointermove", onPointerMove);
			element.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointerup", onPointerUp);
			element.removeEventListener("contextmenu", onContextMenu);
			element.removeEventListener("wheel", onWheel);
		};
	}),
);
