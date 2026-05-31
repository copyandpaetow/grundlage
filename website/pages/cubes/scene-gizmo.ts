import { html, render } from "../../../lib/src";
import {
	blocksBoundsPx,
	formatNumber,
	resolveTriple,
	snapToGrid,
	UNIT_SIZE,
	type Vector3,
} from "./scene-shared";

// <scene-gizmo> — the manipulation knobs, and nothing else. The cage moved out to
// <scene-select>; the gizmo now wraps a scene-select (which in turn holds the
// selected blocks): `<scene-gizmo><scene-select><scene-cube/>…</scene-select></scene-gizmo>`.
// So the gizmo reaches THROUGH the scene-select to the blocks it operates on, and a
// one-block selection and a many-block selection drive through one code path.
//
// The blocks stay the single source of truth for their own transforms: the gizmo
// never carries a transform, it sits its handles at the blocks' shared centroid and,
// during a drag, writes the new values onto the blocks (live --block-* through the
// drag, the authored attribute on drop). Unwrapping needs no bake-back.
//
// The handle frame is WORLD-axis-aligned (it follows the centroid's position, never
// any block's rotation) so the handles never swing behind a turned block and the
// X/Y/Z handles line up with the world axes they actually drive. Translating moves
// every block by the same world delta; the yaw knob spins every block about the
// shared centroid (orbit + local spin), so for a single block it is a spin in place.
//
// Drag projection is DOM-native: the gizmo measures its own handle knobs (already
// perspective-projected by the browser) and turns a pointer delta into world units
// with one dot product — no camera matrix, no reaching across shadow boundaries.

const POSITION_SPECIFIC = ["x", "y", "z"] as const;
const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;
const SIZE_SPECIFIC = ["width", "height", "depth"] as const;
const SELECTABLE = new Set([
	"scene-cube",
	"scene-wall",
	"scene-ramp",
	"scene-group",
]);

const HANDLE_LENGTH = UNIT_SIZE;
const YAW_PER_PIXEL = 0.5;
// Screen-px a knob sits beyond the selection's bounding box, so the handles always
// clear the cage whatever the selection's size.
const HANDLE_MARGIN = 44;

type ScreenPoint = { x: number; y: number };
type DragMode = "x" | "y" | "z" | "yaw";

const dot = (a: ScreenPoint, b: ScreenPoint): number => a.x * b.x + a.y * b.y;

const centerOf = (rectangle: DOMRect): ScreenPoint => ({
	x: rectangle.left + rectangle.width / 2,
	y: rectangle.top + rectangle.height / 2,
});

const addVectors = (a: Vector3, b: Vector3): Vector3 => [
	a[0] + b[0],
	a[1] + b[1],
	a[2] + b[2],
];
const subtractVectors = (a: Vector3, b: Vector3): Vector3 => [
	a[0] - b[0],
	a[1] - b[1],
	a[2] - b[2],
];
// Author-space orbit about Y, matching CSS rotateY. Used to swing blocks around the
// shared centroid as the yaw knob turns.
const rotateAroundY = ([x, y, z]: Vector3, degrees: number): Vector3 => {
	const radians = (degrees * Math.PI) / 180;
	const sin = Math.sin(radians);
	const cos = Math.cos(radians);
	return [x * cos + z * sin, y, -x * sin + z * cos];
};

customElements.define(
	"scene-gizmo",
	render(function* (element) {
		// Watches the wrapped scene-select so the handles follow blocks being added or
		// removed (cmd-click) and attribute edits made elsewhere (the inspector).
		let childObserver: MutationObserver | null = null;
		// Current handle lengths in px per axis — needed to convert a knob's measured
		// screen offset back into one-world-unit screen vectors for drag projection.
		const lengthPx: Vector3 = [HANDLE_LENGTH, HANDLE_LENGTH, HANDLE_LENGTH];
		let drag:
			| {
					mode: DragMode;
					axisIndex: number;
					startPointer: ScreenPoint;
					// Screen displacement for ONE world unit along the dragged axis.
					axisScreen: ScreenPoint;
					centroid: Vector3;
					blocks: HTMLElement[];
					startPositions: Vector3[];
					startRotations: Vector3[];
			  }
			| null = null;

		const readPosition = (target: Element): Vector3 =>
			resolveTriple(target, "position", POSITION_SPECIFIC, 0);
		const readRotation = (target: Element): Vector3 =>
			resolveTriple(target, "rotation", ROTATION_SPECIFIC, 0);

		// Our slotted child is the scene-select; the blocks are its children. Reaching
		// through it keeps the gizmo's knob logic identical for one or many blocks.
		const sceneSelect = (): HTMLElement | null => {
			const slot = element.shadowRoot?.querySelector("slot");
			const assigned = (slot?.assignedElements() ?? [])[0];
			return assigned instanceof HTMLElement ? assigned : null;
		};
		const blocks = (): HTMLElement[] => {
			const host = sceneSelect();
			if (host === null) return [];
			return Array.from(host.children).filter(
				(node): node is HTMLElement =>
					node instanceof HTMLElement &&
					SELECTABLE.has(node.tagName.toLowerCase()),
			);
		};
		const centroidOf = (list: HTMLElement[]): Vector3 => {
			if (list.length === 0) return [0, 0, 0];
			const sum = list
				.map(readPosition)
				.reduce(addVectors, [0, 0, 0] as Vector3);
			return [sum[0] / list.length, sum[1] / list.length, sum[2] / list.length];
		};

		// Sit the handle frame at the selection's shared centroid (world position only,
		// never a rotation), so it stays world-axis-aligned and is the rotation pivot.
		const placeMirror = (centroid: Vector3): void => {
			const mirror = element.shadowRoot?.querySelector(
				".mirror",
			) as HTMLElement | null;
			if (mirror === null) return;
			mirror.style.setProperty("--block-x", `${centroid[0] * UNIT_SIZE}px`);
			mirror.style.setProperty("--block-y", `${-centroid[1] * UNIT_SIZE}px`);
			mirror.style.setProperty("--block-z", `${centroid[2] * UNIT_SIZE}px`);
		};

		// Drive the handle lengths off the selection's bounding box so the knobs clear
		// the cage whatever its size. Written in px onto the unscaled .mirror so the
		// values read straight as screen units; the chrome itself is never scaled
		// (scaling would stretch the knobs and the bars' thickness).
		const sizeChrome = (halfExtentsPx: Vector3): void => {
			const mirror = element.shadowRoot?.querySelector(
				".mirror",
			) as HTMLElement | null;
			if (mirror === null) return;
			(["x", "y", "z"] as const).forEach((axis, index) => {
				const length = halfExtentsPx[index] + HANDLE_MARGIN;
				mirror.style.setProperty(`--len-${axis}`, `${length}px`);
				lengthPx[index] = length;
			});
		};

		const syncHandles = (): void => {
			const list = blocks();
			if (list.length === 0) return;
			placeMirror(centroidOf(list));
			const bounds = blocksBoundsPx(list);
			if (bounds !== null) sizeChrome(bounds.half);
		};

		// Live drag overrides each block's :host values inline (inline wins), staying
		// compositor-only; the commit clears them once the bridge re-resolves.
		const writeBlockPosition = (block: HTMLElement, position: Vector3): void => {
			block.style.setProperty("--block-x", `${position[0] * UNIT_SIZE}px`);
			block.style.setProperty("--block-y", `${-position[1] * UNIT_SIZE}px`);
			block.style.setProperty("--block-z", `${position[2] * UNIT_SIZE}px`);
		};
		const clearBlockLive = (block: HTMLElement): void => {
			block.style.removeProperty("--block-x");
			block.style.removeProperty("--block-y");
			block.style.removeProperty("--block-z");
			block.style.removeProperty("--block-rotate-y");
		};
		// Read a block's live position back out of its inline overrides (px → world,
		// undoing the Y negation), falling back to the drag-start value.
		const readLivePosition = (block: HTMLElement, fallback: Vector3): Vector3 => {
			const read = (name: string, sign = 1): number | null => {
				const raw = block.style.getPropertyValue(name);
				return raw === "" ? null : (parseFloat(raw) / UNIT_SIZE) * sign;
			};
			const x = read("--block-x");
			const y = read("--block-y", -1);
			const z = read("--block-z");
			return [x ?? fallback[0], y ?? fallback[1], z ?? fallback[2]];
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
				// Every block spins about the shared centroid: orbit its position and add
				// the same yaw to its own rotation. For one block centroid == position, so
				// the orbit term is zero and it spins in place. The chrome stays put.
				const deltaYaw = delta.x * YAW_PER_PIXEL;
				active.blocks.forEach((block, index) => {
					const relative = subtractVectors(
						active.startPositions[index],
						active.centroid,
					);
					const orbited = addVectors(
						active.centroid,
						rotateAroundY(relative, deltaYaw),
					);
					writeBlockPosition(block, orbited);
					block.style.setProperty(
						"--block-rotate-y",
						`${active.startRotations[index][1] + deltaYaw}deg`,
					);
				});
				return;
			}

			const lengthSquared = dot(active.axisScreen, active.axisScreen);
			const units =
				lengthSquared === 0 ? 0 : dot(delta, active.axisScreen) / lengthSquared;
			active.blocks.forEach((block, index) => {
				const next = [...active.startPositions[index]] as Vector3;
				next[active.axisIndex] =
					active.startPositions[index][active.axisIndex] + units;
				writeBlockPosition(block, next);
			});
			// The centroid slides by the same delta, so the handles follow live.
			const nextCentroid = [...active.centroid] as Vector3;
			nextCentroid[active.axisIndex] = active.centroid[active.axisIndex] + units;
			placeMirror(nextCentroid);
		};

		const commitDrag = (): void => {
			if (drag === null) return;
			const settled = drag;
			settled.blocks.forEach((block, index) => {
				if (settled.mode === "yaw") {
					const raw = block.style.getPropertyValue("--block-rotate-y");
					const yaw = Math.round(
						raw === "" ? settled.startRotations[index][1] : parseFloat(raw),
					);
					const [rotateX, , rotateZ] = settled.startRotations[index];
					block.setAttribute(
						"rotation",
						`${formatNumber(rotateX)} ${formatNumber(yaw)} ${formatNumber(rotateZ)}`,
					);
				}
				const committed = readLivePosition(
					block,
					settled.startPositions[index],
				).map(snapToGrid) as Vector3;
				block.setAttribute("position", committed.map(formatNumber).join(" "));
				block.removeAttribute("x");
				block.removeAttribute("y");
				block.removeAttribute("z");
			});
			// Re-resolve on the next frame (the bridge update is async) so clearing the
			// inline overrides doesn't flash the pre-commit value, then re-pin the
			// handles to the committed transforms.
			requestAnimationFrame(() => {
				settled.blocks.forEach(clearBlockLive);
				syncHandles();
			});
			drag = null;
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);
		};

		const onHandleDown = (rawEvent: Event): void => {
			const event = rawEvent as PointerEvent;
			if (event.button !== 0) return;
			const list = blocks();
			if (list.length === 0) return;
			const handle = (event.target as HTMLElement)?.closest("[data-axis]");
			if (!(handle instanceof HTMLElement)) return;
			const mode = handle.dataset.axis as DragMode;
			// Keep the editor's host listener from treating this as a select/deselect.
			event.preventDefault();
			event.stopPropagation();

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
				// The knob sits lengthPx px from the origin = lengthPx / UNIT_SIZE world
				// units out; scale its screen offset down to a single world unit so the
				// dot-product projection yields world units directly.
				const worldUnitsOut = lengthPx[axisIndex] / UNIT_SIZE;
				const scale = worldUnitsOut === 0 ? 0 : 1 / worldUnitsOut;
				axisScreen = {
					x: (tip.x - origin.x) * scale,
					y: (tip.y - origin.y) * scale,
				};
			}
			drag = {
				mode,
				axisIndex,
				startPointer: { x: event.clientX, y: event.clientY },
				axisScreen,
				centroid: centroidOf(list),
				blocks: list,
				startPositions: list.map(readPosition),
				startRotations: list.map(readRotation),
			};
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", commitDrag);
		};

		yield html`
			<style>
				:host {
					position: absolute;
					/* Zero size at the world centre, so the slotted scene-select (and the
					   blocks within) keep their own top/left:50% world origin unchanged. The
					   handle frame below positions itself at the blocks' centroid. */
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					pointer-events: none;
				}

				/* Handle frame: follows the centroid's position but NOT any block's
				   rotation, so the handles stay world-axis-aligned (never swing behind a
				   block, and the X/Y/Z handles line up with the world axes they drive). */
				.mirror {
					position: absolute;
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					transform: translate3d(
						var(--block-x, 0px),
						var(--block-y, 0px),
						var(--block-z, 0px)
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
				   center); its length tracks the selection's extent so it always reaches its
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

				/* The wrapped scene-select must share our 3D context, so the slot must not
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

		// Track the wrapped scene-select and keep the handles pinned to its blocks. We
		// watch its light subtree: childList for blocks folded in/out by cmd-click, and
		// the authored transform attributes for inspector edits. We do NOT watch
		// `style`, so the live --block-* writes during a drag don't trigger a feedback
		// resync mid-drag.
		const slot = element.shadowRoot?.querySelector("slot");
		const onSlotChange = (): void => {
			childObserver?.disconnect();
			const host = sceneSelect();
			if (host !== null) {
				childObserver = new MutationObserver(syncHandles);
				childObserver.observe(host, {
					childList: true,
					subtree: true,
					attributeFilter: [
						"position",
						"rotation",
						"size",
						...POSITION_SPECIFIC,
						...ROTATION_SPECIFIC,
						...SIZE_SPECIFIC,
					],
				});
			}
			syncHandles();
		};
		slot?.addEventListener("slotchange", onSlotChange);
		// Catch a scene-select already slotted before this listener attached.
		onSlotChange();
		element.shadowRoot?.addEventListener("pointerdown", onHandleDown);

		return () => {
			slot?.removeEventListener("slotchange", onSlotChange);
			childObserver?.disconnect();
			element.shadowRoot?.removeEventListener("pointerdown", onHandleDown);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);
		};
	}),
);
