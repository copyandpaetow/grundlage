import { html, render } from "../../../lib/src";
import {
	formatNumber,
	resolveTriple,
	snapToGrid,
	UNIT_SIZE,
} from "./scene-shared";

// <scene-gizmo> — an editor-only overlay that wraps the selected block. Selecting
// reparents the block inside a gizmo (<scene-gizmo><scene-cube/></scene-gizmo>),
// deselecting unwraps it again — the element's mere existence is the selection.
//
// The wrapped child stays the single source of truth for its transform: the
// gizmo never carries the transform, it just mirrors the child's position/
// rotation onto its handle chrome and, while a handle is dragged, writes the new
// values onto that same child (live --block-* during the drag, the authored
// attribute on drop). So unwrapping needs no bake-back — the child already holds
// everything.
//
// Drag projection is DOM-native and self-contained: the gizmo measures its own
// handle knobs (already perspective-projected by the browser) and turns a pointer
// delta into world units with one dot product. No camera matrix, no reaching
// across shadow boundaries, no functions bolted onto other elements.

const POSITION_SPECIFIC = ["x", "y", "z"] as const;
const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;
const SIZE_SPECIFIC = ["width", "height", "depth"] as const;

const HANDLE_LENGTH = UNIT_SIZE;
const HALF_UNIT = UNIT_SIZE / 2;
const YAW_PER_PIXEL = 0.5;
// Screen-px the cage sits outside each face, and the px a knob sits beyond that,
// added onto the block's half-extent so the chrome grows with the block.
const CAGE_MARGIN = 6;
const HANDLE_MARGIN = 44;

type ScreenPoint = { x: number; y: number };
type DragMode = "x" | "y" | "z" | "yaw";
type Vector3 = [number, number, number];

const dot = (a: ScreenPoint, b: ScreenPoint): number => a.x * b.x + a.y * b.y;

const centerOf = (rectangle: DOMRect): ScreenPoint => ({
	x: rectangle.left + rectangle.width / 2,
	y: rectangle.top + rectangle.height / 2,
});

customElements.define(
	"scene-gizmo",
	render(function* (element) {
		// The block we annotate: our first slotted element. Resolved on slotchange.
		let child: HTMLElement | null = null;
		// Watches the wrapped child so the chrome follows attribute edits made
		// elsewhere (e.g. the editor's position/rotation/size inspector).
		let childObserver: MutationObserver | null = null;
		let drag:
			| {
					mode: DragMode;
					startPointer: ScreenPoint;
					axisScreen: ScreenPoint;
					startPosition: Vector3;
					startRotation: Vector3;
			  }
			| null = null;

		const readPosition = (target: Element): Vector3 =>
			resolveTriple(target, "position", POSITION_SPECIFIC, 0);
		const readRotation = (target: Element): Vector3 =>
			resolveTriple(target, "rotation", ROTATION_SPECIFIC, 0);
		const readSize = (target: Element): Vector3 =>
			resolveTriple(target, "size", SIZE_SPECIFIC, 1);

		// Mirror the child's translate + rotate onto the chrome frame so both the
		// bounding box and the handles sit on the block in its own orientation
		// (local-axis manipulation). The frame carries no scale — handles must keep
		// a constant pixel size regardless of how big the block is.
		const placeMirror = (position: Vector3, rotation: Vector3): void => {
			const mirror = element.shadowRoot?.querySelector(
				".mirror",
			) as HTMLElement | null;
			if (mirror === null) return;
			mirror.style.setProperty("--block-x", `${position[0] * UNIT_SIZE}px`);
			mirror.style.setProperty("--block-y", `${-position[1] * UNIT_SIZE}px`);
			mirror.style.setProperty("--block-z", `${position[2] * UNIT_SIZE}px`);
			mirror.style.setProperty("--block-rotate-x", `${rotation[0]}deg`);
			mirror.style.setProperty("--block-rotate-y", `${rotation[1]}deg`);
			mirror.style.setProperty("--block-rotate-z", `${rotation[2]}deg`);
		};

		// Drive the cage and the handle lengths off the block's real half-extents so
		// the chrome scales with the block: the cage clears each face by CAGE_MARGIN,
		// each knob sits HANDLE_MARGIN beyond. Written in px onto the unscaled .mirror
		// frame, so the values read straight as world units (no scale to undo). We do
		// NOT scale the chrome itself — scaling would stretch the knobs and the cage's
		// border thickness with the block.
		const sizeChrome = (size: Vector3): void => {
			const mirror = element.shadowRoot?.querySelector(
				".mirror",
			) as HTMLElement | null;
			if (mirror === null) return;
			const axes = ["x", "y", "z"] as const;
			axes.forEach((axis, index) => {
				const halfExtent = size[index] * HALF_UNIT;
				mirror.style.setProperty(`--half-${axis}`, `${halfExtent + CAGE_MARGIN}px`);
				mirror.style.setProperty(`--len-${axis}`, `${halfExtent + HANDLE_MARGIN}px`);
			});
		};

		const syncHandlesToChild = (): void => {
			if (child === null) return;
			placeMirror(readPosition(child), readRotation(child));
			sizeChrome(readSize(child));
		};

		// Live drag overrides the child's :host values inline (inline wins), staying
		// compositor-only; the commit clears them once the bridge re-resolves.
		const writeChildPosition = (position: Vector3): void => {
			if (child === null) return;
			child.style.setProperty("--block-x", `${position[0] * UNIT_SIZE}px`);
			child.style.setProperty("--block-y", `${-position[1] * UNIT_SIZE}px`);
			child.style.setProperty("--block-z", `${position[2] * UNIT_SIZE}px`);
		};
		const writeChildYaw = (yaw: number): void => {
			child?.style.setProperty("--block-rotate-y", `${yaw}deg`);
		};
		const clearChildLive = (target: HTMLElement): void => {
			target.style.removeProperty("--block-x");
			target.style.removeProperty("--block-y");
			target.style.removeProperty("--block-z");
			target.style.removeProperty("--block-rotate-y");
		};

		const handlePoint = (selector: string): ScreenPoint => {
			const node = element.shadowRoot?.querySelector(
				selector,
			) as HTMLElement | null;
			return node ? centerOf(node.getBoundingClientRect()) : { x: 0, y: 0 };
		};

		const onPointerMove = (event: PointerEvent): void => {
			if (drag === null || child === null) return;
			const delta: ScreenPoint = {
				x: event.clientX - drag.startPointer.x,
				y: event.clientY - drag.startPointer.y,
			};

			if (drag.mode === "yaw") {
				const yaw = drag.startRotation[1] + delta.x * YAW_PER_PIXEL;
				writeChildYaw(yaw);
				placeMirror(drag.startPosition, [
					drag.startRotation[0],
					yaw,
					drag.startRotation[2],
				]);
				return;
			}

			const lengthSquared = dot(drag.axisScreen, drag.axisScreen);
			const units =
				lengthSquared === 0 ? 0 : dot(delta, drag.axisScreen) / lengthSquared;
			const axisIndex = drag.mode === "x" ? 0 : drag.mode === "y" ? 1 : 2;
			const next = [...drag.startPosition] as Vector3;
			next[axisIndex] = drag.startPosition[axisIndex] + units;
			writeChildPosition(next);
			placeMirror(next, drag.startRotation);
		};

		const commitDrag = (): void => {
			if (drag === null || child === null) return;
			const settledChild = child;
			if (drag.mode === "yaw") {
				const raw = settledChild.style.getPropertyValue("--block-rotate-y");
				const yaw = Math.round(
					raw === "" ? drag.startRotation[1] : parseFloat(raw),
				);
				const [rotateX, , rotateZ] = drag.startRotation;
				settledChild.setAttribute(
					"rotation",
					`${formatNumber(rotateX)} ${formatNumber(yaw)} ${formatNumber(rotateZ)}`,
				);
			} else {
				const read = (name: string, fallback: number, sign = 1): number => {
					const raw = settledChild.style.getPropertyValue(name);
					return raw === "" ? fallback : (parseFloat(raw) / UNIT_SIZE) * sign;
				};
				const committed = [
					read("--block-x", drag.startPosition[0]),
					read("--block-y", drag.startPosition[1], -1),
					read("--block-z", drag.startPosition[2]),
				].map(snapToGrid) as Vector3;
				settledChild.setAttribute(
					"position",
					committed.map(formatNumber).join(" "),
				);
				settledChild.removeAttribute("x");
				settledChild.removeAttribute("y");
				settledChild.removeAttribute("z");
			}
			// Re-resolve on the next frame (the bridge update is async) so clearing
			// the inline overrides doesn't flash the pre-commit value, then re-pin the
			// handles to the committed transform.
			requestAnimationFrame(() => {
				clearChildLive(settledChild);
				syncHandlesToChild();
			});
			drag = null;
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);
		};

		const onHandleDown = (rawEvent: Event): void => {
			const event = rawEvent as PointerEvent;
			if (event.button !== 0 || child === null) return;
			const handle = (event.target as HTMLElement)?.closest("[data-axis]");
			if (!(handle instanceof HTMLElement)) return;
			const mode = handle.dataset.axis as DragMode;
			// Keep the editor's host listener from treating this as a select/deselect.
			event.preventDefault();
			event.stopPropagation();

			const origin = handlePoint("#origin");
			const tip =
				mode === "x"
					? handlePoint("#knob-x")
					: mode === "y"
						? handlePoint("#knob-y")
						: handlePoint("#knob-z");
			drag = {
				mode,
				startPointer: { x: event.clientX, y: event.clientY },
				axisScreen:
					mode === "yaw"
						? { x: 0, y: 0 }
						: { x: tip.x - origin.x, y: tip.y - origin.y },
				startPosition: readPosition(child),
				startRotation: readRotation(child),
			};
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", commitDrag);
		};

		yield html`
			<style>
				:host {
					position: absolute;
					/* Zero size at the world centre, exactly like the block before wrapping, so
					   the slotted child's own top/left:50% still resolves to the world centre and
					   its transform is unchanged. The chrome below mirrors the child. */
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					pointer-events: none;
				}

				/* Shared chrome frame: mirrors the child's translate + rotate (never its scale).
				   Both the bounding box and the handles live in this frame, so they pick up the
				   block's local orientation for local-axis manipulation. */
				.mirror {
					position: absolute;
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					transform: translate3d(
							var(--block-x, 0px),
							var(--block-y, 0px),
							var(--block-z, 0px)
						)
						rotateX(var(--block-rotate-x, 0deg))
						rotateY(var(--block-rotate-y, 0deg))
						rotateZ(var(--block-rotate-z, 0deg));
				}

				/* Faint cage sized a hair outside the block (driven by --half-*), so the
				   selection reads as large as its child instead of a zero-size point. The
				   cage is NOT scaled — it is built from explicit half-extents, so its border
				   stays 1px and it always clears the opaque faces enough to be seen. */
				.body {
					position: absolute;
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					pointer-events: none;
				}
				.body .edge {
					position: absolute;
					top: 50%;
					left: 50%;
					box-sizing: border-box;
					border: 1px solid rgba(255, 255, 255, 0.6);
					background: rgba(255, 255, 255, 0.04);
				}
				.body .front,
				.body .back {
					width: calc(2 * var(--half-x, ${HALF_UNIT}px));
					height: calc(2 * var(--half-y, ${HALF_UNIT}px));
					margin: calc(-1 * var(--half-y, ${HALF_UNIT}px)) 0 0 calc(-1 * var(--half-x, ${HALF_UNIT}px));
				}
				.body .front { transform: translateZ(var(--half-z, ${HALF_UNIT}px)); }
				.body .back { transform: translateZ(calc(-1 * var(--half-z, ${HALF_UNIT}px))); }
				.body .right,
				.body .left {
					width: calc(2 * var(--half-z, ${HALF_UNIT}px));
					height: calc(2 * var(--half-y, ${HALF_UNIT}px));
					margin: calc(-1 * var(--half-y, ${HALF_UNIT}px)) 0 0 calc(-1 * var(--half-z, ${HALF_UNIT}px));
				}
				.body .right { transform: rotateY(90deg) translateZ(var(--half-x, ${HALF_UNIT}px)); }
				.body .left { transform: rotateY(-90deg) translateZ(var(--half-x, ${HALF_UNIT}px)); }
				.body .top,
				.body .bottom {
					width: calc(2 * var(--half-x, ${HALF_UNIT}px));
					height: calc(2 * var(--half-z, ${HALF_UNIT}px));
					margin: calc(-1 * var(--half-z, ${HALF_UNIT}px)) 0 0 calc(-1 * var(--half-x, ${HALF_UNIT}px));
				}
				.body .top { transform: rotateX(90deg) translateZ(var(--half-y, ${HALF_UNIT}px)); }
				.body .bottom { transform: rotateX(-90deg) translateZ(var(--half-y, ${HALF_UNIT}px)); }

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
				   center); its length tracks the block's half-extent so it always reaches its
				   knob, whatever the block's size. */
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

				/* +x runs right: the bar needs no rotation (its left edge is the origin). */
				.axis-x .bar { width: var(--len-x, ${HANDLE_LENGTH}px); background: #ff5d5d; }
				.axis-x .knob {
					transform: translateX(var(--len-x, ${HANDLE_LENGTH}px));
					background: #ff5d5d;
				}
				/* Author +Y is up; screen +Y is down, so the up handle points -y. */
				.axis-y .bar {
					width: var(--len-y, ${HANDLE_LENGTH}px);
					transform: rotateZ(-90deg);
					background: #62d562;
				}
				.axis-y .knob {
					transform: translateY(calc(-1 * var(--len-y, ${HANDLE_LENGTH}px)));
					background: #62d562;
				}
				/* +z points toward the viewer. */
				.axis-z .bar {
					width: var(--len-z, ${HANDLE_LENGTH}px);
					transform: rotateY(-90deg);
					background: #5d9dff;
				}
				.axis-z .knob {
					transform: translateZ(var(--len-z, ${HANDLE_LENGTH}px));
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
					transform: translate3d(calc(var(--len-x, ${HANDLE_LENGTH}px) * 0.7), 0, calc(var(--len-z, ${HANDLE_LENGTH}px) * 0.7));
				}

				/* The wrapped child must share our 3D context, so the slot must not introduce a
				   flattening box. */
				slot {
					display: contents;
				}
			</style>
			<div class="mirror">
				<div class="body">
					<div class="edge front"></div>
					<div class="edge back"></div>
					<div class="edge right"></div>
					<div class="edge left"></div>
					<div class="edge top"></div>
					<div class="edge bottom"></div>
				</div>
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

		// Track which block we wrap, and keep the handles pinned to it. The slot
		// fires this once the editor reparents the child into us.
		const slot = element.shadowRoot?.querySelector("slot");
		const onSlotChange = (): void => {
			const assigned = slot?.assignedElements() ?? [];
			child = (assigned[0] as HTMLElement | undefined) ?? null;
			// Follow attribute edits the child receives from elsewhere (the editor's
			// inspector) so the chrome stays pinned. We watch only the authored
			// transform attributes, never `style`, so the live --block-* writes during
			// a handle drag don't trigger a feedback resync mid-drag.
			childObserver?.disconnect();
			if (child !== null) {
				childObserver = new MutationObserver(syncHandlesToChild);
				childObserver.observe(child, {
					attributes: true,
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
			syncHandlesToChild();
		};
		slot?.addEventListener("slotchange", onSlotChange);
		// Catch a child that was already slotted before this listener attached, so
		// the handles pin to the block regardless of wrap/render ordering.
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
