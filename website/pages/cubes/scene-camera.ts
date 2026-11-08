import { html, component, prop } from "../../../lib/src";

//The pose is written as the world's camera-* attributes, so a copied world carries the
//flown view with it. Each mode is its own update generator, so switching tears down
//the other's listeners and neither needs a mode check.

const props = { mode: prop.attribute(prop.oneOf("free", "orbit"), "free") };

const MOVE_PIXELS_PER_FRAME = 12;
const LOOK_DEGREES_PER_PIXEL = 0.18;
const MAX_PITCH = 89;
const DEFAULT_ORBIT_RADIUS = 600;

//[right, up, forward] in camera space. Screen +Y is down, so up is -1.
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

//No box of its own, so the world keeps its perspective box
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
			const camera = {
				x: 0,
				y: -160,
				z: 600,
				yaw: 0,
				pitch: 0,
				orbitRadius: 0,
			};
			//The slotted element, so a stray unslotted child is never taken for the world
			let world: HTMLElement | null = null;

			//Write-only, so it never forces a synchronous layout
			const writeCameraVariables = (): void => {
				if (world === null) return;
				world.setAttribute("camera-x", `${camera.x}px`);
				world.setAttribute("camera-y", `${camera.y}px`);
				world.setAttribute("camera-z", `${camera.z}px`);
				world.setAttribute("camera-yaw", `${camera.yaw}deg`);
				world.setAttribute("camera-pitch", `${camera.pitch}deg`);
				world.setAttribute("camera-orbit-radius", `${camera.orbitRadius}px`);
			};

			const onLookMove = (event: PointerEvent): void => {
				//The world applies rotateY(-yaw), so dragging right must DECREASE yaw to
				//face +X; dragging down looks down.
				camera.yaw -= event.movementX * LOOK_DEGREES_PER_PIXEL;
				camera.pitch = clamp(
					camera.pitch + event.movementY * LOOK_DEGREES_PER_PIXEL,
					-MAX_PITCH,
					MAX_PITCH,
				);
				writeCameraVariables();
			};

			const onLookUp = (): void => {
				window.removeEventListener("pointermove", onLookMove);
				window.removeEventListener("pointerup", onLookUp);
			};

			//Alt + left-drag is the look gesture: touchpad-safe, no right button.
			const onPointerDown = (event: PointerEvent): void => {
				if (event.button !== 0 || !event.altKey) return;
				event.preventDefault();
				window.addEventListener("pointermove", onLookMove);
				window.addEventListener("pointerup", onLookUp);
			};

			function* freeFlyCamera() {
				const pressedKeys = new Set<string>();
				let animationFrame = 0;

				//The world applies rotateY(-yaw), so the heading is its inverse:
				//   forward = Ry(yaw)·(0, 0, -1) = (-sin yaw, 0, -cos yaw)
				//   right   = Ry(yaw)·(1, 0, 0)  = (cos yaw, 0, -sin yaw)
				//Other signs invert WASD after a turn.
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
						camera.x += MOVE_PIXELS_PER_FRAME * (alongRight * rightX + alongForward * forwardX);
						camera.z += MOVE_PIXELS_PER_FRAME * (alongRight * rightZ + alongForward * forwardZ);
						camera.y += MOVE_PIXELS_PER_FRAME * alongUp;
					}

					writeCameraVariables();
					animationFrame = pressedKeys.size > 0 ? requestAnimationFrame(stepWhileKeysHeld) : 0;
				};

				const onKeyDown = (event: KeyboardEvent): void => {
					//The editor's inputs live in shadow DOM, so at window scope
					//event.target is retargeted to the host; composedPath()[0] is real.
					if (event.composedPath()[0] instanceof HTMLInputElement) return;
					const key = event.key.toLowerCase();
					if (!MOVEMENT_KEYS.has(key)) return;
					pressedKeys.add(key);
					if (animationFrame === 0) animationFrame = requestAnimationFrame(stepWhileKeysHeld);
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

			//Entering keeps the current distance as the radius, so the view does not zoom
			function* orbitCamera() {
				camera.orbitRadius = Math.hypot(camera.x, camera.y, camera.z) || DEFAULT_ORBIT_RADIUS;
				camera.x = 0;
				camera.y = 0;
				camera.z = 0;

				const onWheel = (event: WheelEvent): void => {
					camera.orbitRadius = clamp(camera.orbitRadius + event.deltaY, 120, 4000);
					writeCameraVariables();
					event.preventDefault();
				};

				yield transparentShell;

				writeCameraVariables();
				element.addEventListener("wheel", onWheel, { passive: false });

				//Free flight moves a position, so leaving resolves the eye the orbit implied:
				//   r·(sin yaw·cos pitch, -sin pitch, cos yaw·cos pitch)
				return () => {
					const yawRadians = toRadians(camera.yaw);
					const pitchRadians = toRadians(camera.pitch);
					camera.x = camera.orbitRadius * Math.sin(yawRadians) * Math.cos(pitchRadians);
					camera.y = -camera.orbitRadius * Math.sin(pitchRadians);
					camera.z = camera.orbitRadius * Math.cos(yawRadians) * Math.cos(pitchRadians);
					camera.orbitRadius = 0;
					writeCameraVariables();
					element.removeEventListener("wheel", onWheel);
				};
			}

			yield transparentShell;

			//Client only: the server stops at the yield above, so the world renders at its
			//default angle
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
