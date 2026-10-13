import { html, component } from "../../../lib/src";

// <scene-camera> — the navigation wrapper. It owns the camera *state* and every
// input that moves it (WASD free-fly, Alt-drag look, wheel zoom, free/orbit mode)
// and nothing else. It renders transparently: a `display:contents` host around a
// `display:contents` slot, so the world it wraps keeps its own perspective box.
//
// The camera is a pure INPUT device: it writes the `--camera-*` custom properties onto
// its direct child — the world itself — rather than onto its own host. So the variables
// LIVE ON the world, and the camera only edits them. That keeps the world the one
// self-contained artifact: fly the camera to a view, then copy the world element (its
// inline `--camera-*` come with it) and paste it anywhere — bare, with no camera — and
// it renders that exact view as a static scene, perfectly placed. We touch document.head
// never; several cameras can coexist and we drop cleanly.

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
// Each movement key as a unit step in camera space: [right, up, forward]. This table
// is the single source of truth for free-fly movement — both which keys start the step
// loop (MOVEMENT_KEYS, derived below) and how each one moves the camera (step()).
// Screen-space +Y is down, so "up" (space) is -1.
const MOVE_AXES: Record<string, [number, number, number]> = {
	w: [0, 0, 1],
	s: [0, 0, -1],
	d: [1, 0, 0],
	a: [-1, 0, 0],
	" ": [0, -1, 0],
	shift: [0, 1, 0],
};
// Keys that drive free-fly movement; anything else never starts the step loop.
const MOVEMENT_KEYS = new Set(Object.keys(MOVE_AXES));

// Constrain a value to the inclusive [minimum, maximum] range.
const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.max(minimum, Math.min(maximum, value));

customElements.define(
	"scene-camera",
	component(function* ({ host: element }) {
		const camera: CameraState = { x: 0, y: -160, z: 600, yaw: 0, pitch: 0 };
		const pressedKeys = new Set<string>();
		let animationFrame = 0;
		// The world we drive — the element assigned to our slot, resolved after the first
		// yield. We write the camera variables onto ITS style, so the world owns them and
		// stays portable.
		let world: HTMLElement | null = null;

		// Orbit is the constrained camera ("inspect the scene"): it pivots around a
		// fixed target instead of flying free. We keep the same yaw/pitch + inverse-
		// camera wrapper — only the camera position is derived. Target is the origin.
		const ORBIT_TARGET = { x: 0, y: 0, z: 0 };
		let cameraMode: "free" | "orbit" = "free";
		let orbitRadius = 600;

		// The only place camera state reaches CSS, and it is write-only (no layout
		// read), so there is no forced synchronous layout. Variables land on the world
		// itself (our direct child), which is what keeps the world copy-paste portable.
		const writeCamera = (): void => {
			if (world === null) return;

			const style = world.style;
			style.setProperty("--camera-x", `${camera.x}px`);
			style.setProperty("--camera-y", `${camera.y}px`);
			style.setProperty("--camera-z", `${camera.z}px`);
			style.setProperty("--camera-yaw", `${camera.yaw}deg`);
			style.setProperty("--camera-pitch", `${camera.pitch}deg`);
		};

		// World basis derived from yaw. The world's wrapper applies rotateY(-yaw), so the
		// camera's actual forward is rotateY(yaw)·(0,0,-1) = (-sin, 0, -cos) and its
		// right is rotateY(yaw)·(1,0,0) = (cos, 0, -sin). Getting these signs to agree
		// with the wrapper is exactly what keeps WASD from inverting after a turn.
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

		// Sit the camera one radius behind the orbit target along the view direction,
		// so it always faces the target.
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

		// The one reconcile: in orbit the position is derived from yaw/pitch/radius, then
		// every path pushes the current state to CSS through here.
		const commit = (): void => {
			if (cameraMode === "orbit") applyOrbit();
			writeCamera();
		};

		// Free-fly: translate along the heading derived from yaw, so "forward" follows
		// where we look. Runs only while a movement key is held.
		const step = (): void => {
			if (cameraMode === "free") {
				const { forward, right } = basis();
				for (const key of pressedKeys) {
					const axis = MOVE_AXES[key];
					if (axis === undefined) continue;
					const [alongRight, alongUp, alongForward] = axis;
					camera.x +=
						MOVE_SPEED * (alongRight * right[0] + alongForward * forward[0]);
					camera.z +=
						MOVE_SPEED * (alongRight * right[1] + alongForward * forward[1]);
					camera.y += MOVE_SPEED * alongUp;
				}
			}

			commit();
			animationFrame = pressedKeys.size > 0 ? requestAnimationFrame(step) : 0;
		};

		const startStepping = (): void => {
			// Only free-fly consumes held keys; in orbit the loop would just write
			// unchanged state every frame, so don't start it.
			if (cameraMode === "free" && animationFrame === 0)
				animationFrame = requestAnimationFrame(step);
		};

		const onKeyDown = (event: KeyboardEvent): void => {
			// Don't hijack typing in the editor's inputs (e.g. size fields). The inputs
			// live in shadow DOM, so event.target is retargeted to the host at window
			// scope — composedPath()[0] is the real target.
			if (event.composedPath()[0] instanceof HTMLInputElement) return;
			const key = event.key.toLowerCase();
			if (!MOVEMENT_KEYS.has(key)) return;
			pressedKeys.add(key);
			startStepping();
		};

		const onKeyUp = (event: KeyboardEvent): void => {
			pressedKeys.delete(event.key.toLowerCase());
		};

		// --- Look (Alt + left-drag) and zoom (wheel) -------------------------------

		const onLookMove = (event: PointerEvent): void => {
			// Drag right looks right (yaw decreases to face +X under rotateY(-yaw));
			// drag down looks down.
			camera.yaw -= event.movementX * LOOK_SENSITIVITY;
			camera.pitch = clamp(
				camera.pitch + event.movementY * LOOK_SENSITIVITY,
				-MAX_PITCH,
				MAX_PITCH,
			);
			commit();
		};

		const onLookUp = (): void => {
			window.removeEventListener("pointermove", onLookMove);
			window.removeEventListener("pointerup", onLookUp);
		};

		const onPointerDown = (event: PointerEvent): void => {
			// Alt + drag is the look gesture (touchpad-safe — no right button).
			if (event.button !== 0 || !event.altKey) return;
			event.preventDefault();
			window.addEventListener("pointermove", onLookMove);
			window.addEventListener("pointerup", onLookUp);
		};

		const onWheel = (event: WheelEvent): void => {
			// Wheel only zooms in orbit; in free-fly we leave the page to scroll.
			if (cameraMode !== "orbit") return;
			orbitRadius = clamp(orbitRadius + event.deltaY, 120, 4000);
			commit();
			event.preventDefault();
		};

		// --- Free / orbit mode -----------------------------------------------------

		// The mode is driven from the outside through our `mode` attribute, so the editor
		// (or any author) toggles it declaratively with setAttribute and we react. Entering
		// orbit freezes the current distance as the radius and snaps onto the orbit; leaving
		// it just keeps the current pose and lets WASD fly free again.
		const enterOrbit = (): void => {
			cameraMode = "orbit";
			orbitRadius =
				Math.hypot(
					camera.x - ORBIT_TARGET.x,
					camera.y - ORBIT_TARGET.y,
					camera.z - ORBIT_TARGET.z,
				) || orbitRadius;
			commit();
		};

		const applyMode = (): void => {
			const wantsOrbit = element.getAttribute("mode") === "orbit";
			if (wantsOrbit && cameraMode !== "orbit") enterOrbit();
			else if (!wantsOrbit && cameraMode !== "free") cameraMode = "free";
		};

		yield html`
			<style>
				/* Transparent: we add navigation, not a box. The wrapped world keeps its
				   own perspective box; we just write its --camera-* from the outside. */
				:host {
					display: contents;
				}
				slot {
					display: contents;
				}
			</style>
			<slot></slot>
		`;

		// The shadow content now exists, so wire up interactivity. This all sits after the
		// first yield, which the lib reaches only on the client: on the server it stops the
		// generator here, so the camera ships no JS and the world renders at its default
		// angle. We drive the element we actually project — the one assigned to our slot,
		// not merely our first child — so a stray non-slotted child can't be mistaken for
		// the world, and a slotchange would let us re-target if the world were ever swapped.
		const slot = element.shadowRoot?.querySelector("slot");
		world = (slot?.assignedElements()[0] as HTMLElement | undefined) ?? null;
		writeCamera();
		applyMode();
		const modeObserver = new MutationObserver(applyMode);
		modeObserver.observe(element, {
			attributes: true,
			attributeFilter: ["mode"],
		});
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		element.addEventListener("pointerdown", onPointerDown);
		element.addEventListener("wheel", onWheel, { passive: false });

		// Generator return = teardown. The lib fires this on disconnect — client-only,
		// since on the server the generator never steps past the yield to reach here.
		return () => {
			if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
			modeObserver.disconnect();
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("pointermove", onLookMove);
			window.removeEventListener("pointerup", onLookUp);
			element.removeEventListener("pointerdown", onPointerDown);
			element.removeEventListener("wheel", onWheel);
		};
	}),
);
