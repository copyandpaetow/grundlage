import { html, render } from "../../../lib/src";
import { installCameraProperties } from "./scene-shared";

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

		// Free-fly: we translate along the heading derived from yaw, so "forward"
		// always follows where we look. Forward is -Z at yaw 0. This runs only
		// while a movement key is held, so a still camera does no frame work.
		const step = (): void => {
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

		// Mouse-look is event-driven: we adjust orientation only when the pointer
		// actually moves, and only while this element holds the pointer lock.
		const onPointerMove = (event: PointerEvent): void => {
			if (document.pointerLockElement !== element) return;
			camera.yaw += event.movementX * LOOK_SENSITIVITY;
			camera.pitch = Math.max(
				-MAX_PITCH,
				Math.min(MAX_PITCH, camera.pitch + event.movementY * LOOK_SENSITIVITY),
			);
			writeCamera();
		};

		const onClick = (): void => {
			element.requestPointerLock();
		};

		// Listeners and the initial camera write are client-only; on the server
		// the generator still produces the static markup without them.
		if (typeof window !== "undefined") {
			writeCamera();
			window.addEventListener("keydown", onKeyDown);
			window.addEventListener("keyup", onKeyUp);
			window.addEventListener("pointermove", onPointerMove);
			element.addEventListener("click", onClick);
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
					cursor: grab;
					perspective: var(--camera-perspective);
					perspective-origin: 50% 50%;
				}
				:host(:active) {
					cursor: grabbing;
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

		// Generator return = teardown. The lib fires this on disconnect.
		return () => {
			if (typeof window === "undefined") return;
			if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("pointermove", onPointerMove);
			element.removeEventListener("click", onClick);
		};
	}),
);
