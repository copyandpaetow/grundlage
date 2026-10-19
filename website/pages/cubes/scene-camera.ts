import { html, component } from "../../../lib/src";
import type { Schema } from "../../../lib/src/types";

// <scene-camera> — the navigation wrapper. It owns the camera state and every input that
// moves it, and nothing else. It renders transparently, so the world it wraps keeps its
// own perspective box.
//
// The camera is a pure INPUT device: it writes --camera-* onto its direct child, the
// world, never onto its own host or document.head. So the variables LIVE ON the world and
// the camera only edits them — fly to a view, copy the world element (its inline
// --camera-* come with it), paste it anywhere bare, and it renders that exact view as a
// static scene. Several cameras can coexist and any of them can drop out cleanly.
//
// `mode` picks which body runs: free-fly owns the keys and the step loop, orbit owns the
// wheel and derives the position from yaw/pitch/radius. Switching tears one down and sets
// the other up, so neither carries the other's listeners or a mode check.

const props = { mode: [String, "free"] } satisfies Schema;

// px advanced per animation frame while a movement key is held.
const MOVE_SPEED = 12;
// degrees of rotation per pixel of pointer movement while looking.
const LOOK_SENSITIVITY = 0.18;
const MAX_PITCH = 89;
const DEFAULT_ORBIT_RADIUS = 600;

// Each movement key as a unit step in camera space: [right, up, forward]. Screen-space
// +Y is down, so "up" (space) is -1.
const MOVE_AXES: Record<string, [number, number, number]> = {
	w: [0, 0, 1],
	s: [0, 0, -1],
	d: [1, 0, 0],
	a: [-1, 0, 0],
	" ": [0, -1, 0],
	shift: [0, 1, 0],
};
const MOVEMENT_KEYS = new Set(Object.keys(MOVE_AXES));

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.max(minimum, Math.min(maximum, value));

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

// We add navigation, not a box: the wrapped world keeps its own perspective box and we
// only write its --camera-* from the outside.
const transparentShell = html`
	<style>
		:host {
			display: contents;
		}
		slot {
			display: contents;
		}
	</style>
	<slot></slot>
`;

customElements.define(
	"scene-camera",
	component(
		function* ({ host: element }) {
			const camera = { x: 0, y: -160, z: 600, yaw: 0, pitch: 0 };
			// The element assigned to our slot, resolved after the first yield. We drive
			// what we actually project, so a stray non-slotted child is never mistaken for
			// the world.
			let world: HTMLElement | null = null;
			// Orbit installs its derivation here; free-fly leaves the pose as authored.
			let deriveCameraPosition: (() => void) | null = null;

			// The only place camera state reaches CSS, and it is write-only, so no forced
			// synchronous layout.
			const writeCameraVariables = (): void => {
				if (world === null) return;
				const style = world.style;
				style.setProperty("--camera-x", `${camera.x}px`);
				style.setProperty("--camera-y", `${camera.y}px`);
				style.setProperty("--camera-z", `${camera.z}px`);
				style.setProperty("--camera-yaw", `${camera.yaw}deg`);
				style.setProperty("--camera-pitch", `${camera.pitch}deg`);
			};

			const commitCameraPose = (): void => {
				deriveCameraPosition?.();
				writeCameraVariables();
			};

			const onLookMove = (event: PointerEvent): void => {
				// The world applies rotateY(-yaw), so dragging right must DECREASE yaw to
				// face +X; dragging down looks down.
				camera.yaw -= event.movementX * LOOK_SENSITIVITY;
				camera.pitch = clamp(
					camera.pitch + event.movementY * LOOK_SENSITIVITY,
					-MAX_PITCH,
					MAX_PITCH,
				);
				commitCameraPose();
			};

			const onLookUp = (): void => {
				window.removeEventListener("pointermove", onLookMove);
				window.removeEventListener("pointerup", onLookUp);
			};

			// Alt + left-drag is the look gesture: touchpad-safe, no right button.
			const onPointerDown = (event: PointerEvent): void => {
				if (event.button !== 0 || !event.altKey) return;
				event.preventDefault();
				window.addEventListener("pointermove", onLookMove);
				window.addEventListener("pointerup", onLookUp);
			};

			function* freeFlyCamera() {
				const pressedKeys = new Set<string>();
				let animationFrame = 0;

				// Translate along the heading derived from yaw, so "forward" follows where
				// we look. The world applies rotateY(-yaw), so our forward is
				// rotateY(yaw)·(0,0,-1) and our right is rotateY(yaw)·(1,0,0); getting
				// these signs to agree with the world is what keeps WASD from inverting
				// after a turn.
				const stepWhileKeysHeld = (): void => {
					const yawRadians = toRadians(camera.yaw);
					const forwardX = -Math.sin(yawRadians);
					const forwardZ = -Math.cos(yawRadians);
					const rightX = Math.cos(yawRadians);
					const rightZ = -Math.sin(yawRadians);

					for (const key of pressedKeys) {
						const axis = MOVE_AXES[key];
						if (axis === undefined) continue;
						const [alongRight, alongUp, alongForward] = axis;
						camera.x +=
							MOVE_SPEED * (alongRight * rightX + alongForward * forwardX);
						camera.z +=
							MOVE_SPEED * (alongRight * rightZ + alongForward * forwardZ);
						camera.y += MOVE_SPEED * alongUp;
					}

					commitCameraPose();
					animationFrame =
						pressedKeys.size > 0 ? requestAnimationFrame(stepWhileKeysHeld) : 0;
				};

				const onKeyDown = (event: KeyboardEvent): void => {
					// The editor's inputs live in shadow DOM, so at window scope
					// event.target is retargeted to the host; composedPath()[0] is real.
					if (event.composedPath()[0] instanceof HTMLInputElement) return;
					const key = event.key.toLowerCase();
					if (!MOVEMENT_KEYS.has(key)) return;
					pressedKeys.add(key);
					if (animationFrame === 0)
						animationFrame = requestAnimationFrame(stepWhileKeysHeld);
				};

				const onKeyUp = (event: KeyboardEvent): void => {
					pressedKeys.delete(event.key.toLowerCase());
				};

				yield transparentShell;

				window.addEventListener("keydown", onKeyDown);
				window.addEventListener("keyup", onKeyUp);

				return () => {
					if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
					window.removeEventListener("keydown", onKeyDown);
					window.removeEventListener("keyup", onKeyUp);
				};
			}

			// The constrained camera: it pivots around the origin instead of flying free,
			// so the position is derived and only yaw/pitch/radius are input. Entering
			// freezes the current distance as the radius, so the view snaps onto the orbit
			// without jumping.
			function* orbitCamera() {
				let orbitRadius =
					Math.hypot(camera.x, camera.y, camera.z) || DEFAULT_ORBIT_RADIUS;

				const placeCameraBehindTarget = (): void => {
					const yawRadians = toRadians(camera.yaw);
					const pitchRadians = toRadians(camera.pitch);
					camera.x =
						orbitRadius * Math.sin(yawRadians) * Math.cos(pitchRadians);
					camera.y = -orbitRadius * Math.sin(pitchRadians);
					camera.z =
						orbitRadius * Math.cos(yawRadians) * Math.cos(pitchRadians);
				};

				const onWheel = (event: WheelEvent): void => {
					orbitRadius = clamp(orbitRadius + event.deltaY, 120, 4000);
					commitCameraPose();
					event.preventDefault();
				};

				deriveCameraPosition = placeCameraBehindTarget;

				yield transparentShell;

				commitCameraPose();
				element.addEventListener("wheel", onWheel, { passive: false });

				return () => {
					deriveCameraPosition = null;
					element.removeEventListener("wheel", onWheel);
				};
			}

			yield transparentShell;

			// Everything below runs only on the client: on the server the generator stops
			// at the yield, so the camera ships no JS and the world renders at its default
			// angle.
			const slot = element.shadowRoot?.querySelector("slot");
			world = (slot?.assignedElements()[0] as HTMLElement | undefined) ?? null;
			writeCameraVariables();
			element.addEventListener("pointerdown", onPointerDown);

			yield function* view({ mode }) {
				return yield* mode === "orbit" ? orbitCamera() : freeFlyCamera();
			};

			return () => {
				window.removeEventListener("pointermove", onLookMove);
				window.removeEventListener("pointerup", onLookUp);
				element.removeEventListener("pointerdown", onPointerDown);
			};
		},
		{ props },
	),
);
