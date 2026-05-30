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

const HANDLE_LENGTH = UNIT_SIZE;
const YAW_PER_PIXEL = 0.5;

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

		// Mirror a transform onto the handle chrome so the handles sit on the block
		// in its own orientation (local-axis manipulation).
		const placeHandles = (position: Vector3, rotation: Vector3): void => {
			const handles = element.shadowRoot?.querySelector(
				".handles",
			) as HTMLElement | null;
			if (handles === null) return;
			handles.style.setProperty("--block-x", `${position[0] * UNIT_SIZE}px`);
			handles.style.setProperty("--block-y", `${-position[1] * UNIT_SIZE}px`);
			handles.style.setProperty("--block-z", `${position[2] * UNIT_SIZE}px`);
			handles.style.setProperty("--block-rotate-x", `${rotation[0]}deg`);
			handles.style.setProperty("--block-rotate-y", `${rotation[1]}deg`);
			handles.style.setProperty("--block-rotate-z", `${rotation[2]}deg`);
		};

		const syncHandlesToChild = (): void => {
			if (child === null) return;
			placeHandles(readPosition(child), readRotation(child));
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
				placeHandles(drag.startPosition, [
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
			placeHandles(next, drag.startRotation);
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
					/* Sit at the world centre with zero size, exactly like the block
					   did before wrapping, so the slotted child's own top/left:50% still
					   resolves to the world centre and its transform is unchanged. The
					   wrapper itself contributes no transform: the child renders through
					   the slot and the handle chrome below mirrors it. */
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					pointer-events: none;
				}

				.handles {
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

				.axis-x .bar {
					transform: translateX(${HANDLE_LENGTH / 2}px);
					background: #ff5d5d;
				}
				.axis-x .knob {
					transform: translateX(${HANDLE_LENGTH}px);
					background: #ff5d5d;
				}
				.axis-y .bar {
					transform: rotateZ(90deg) translateX(${-HANDLE_LENGTH / 2}px);
					background: #62d562;
				}
				.axis-y .knob {
					transform: translateY(${-HANDLE_LENGTH}px);
					background: #62d562;
				}
				.axis-z .bar {
					transform: rotateY(90deg) translateX(${-HANDLE_LENGTH / 2}px);
					background: #5d9dff;
				}
				.axis-z .knob {
					transform: translateZ(${HANDLE_LENGTH}px);
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
						${HANDLE_LENGTH * 0.7}px,
						0,
						${HANDLE_LENGTH * 0.7}px
					);
				}

				/* The wrapped child must share our 3D context, so the slot must not
				   introduce a flattening box. */
				slot {
					display: contents;
				}
			</style>
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
			<slot></slot>
		`;

		// Track which block we wrap, and keep the handles pinned to it. The slot
		// fires this once the editor reparents the child into us.
		const slot = element.shadowRoot?.querySelector("slot");
		const onSlotChange = (): void => {
			const assigned = slot?.assignedElements() ?? [];
			child = (assigned[0] as HTMLElement | undefined) ?? null;
			syncHandlesToChild();
		};
		slot?.addEventListener("slotchange", onSlotChange);
		// Catch a child that was already slotted before this listener attached, so
		// the handles pin to the block regardless of wrap/render ordering.
		onSlotChange();
		element.shadowRoot?.addEventListener("pointerdown", onHandleDown);

		return () => {
			slot?.removeEventListener("slotchange", onSlotChange);
			element.shadowRoot?.removeEventListener("pointerdown", onHandleDown);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", commitDrag);
		};
	}),
);
