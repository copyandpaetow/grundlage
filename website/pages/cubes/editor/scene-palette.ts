import { html, props, render } from "../../../../lib/src";
import type { BaseComponent } from "../../../../lib/src/types";

// <scene-palette> — the editor's 2D chrome: the toolbar (add / group / camera /
// export) and the transform inspector. It is pure presentation and owns no editor
// state. The editor hands it two things through the complex-value channel (JS
// properties, per the attribute-vs-property rule): a `handlers` bag it calls on
// click / input, and an `inspector` snapshot it renders the number fields from.
// One render channel: the editor never reaches in to poke an input — it writes the
// `inspector` prop and we re-render through update(). The handlers are read once at
// connect (the editor sets them before mounting us, and they never change); only
// `inspector` and the camera label drive re-renders.

// The three transform fields the inspector edits, each mapped to a per-axis triple.
export type InspectorField = "position" | "rotation" | "size";

// The callbacks the toolbar and inspector fire. The editor owns the behaviour; we
// only translate a click or an input event into the matching call.
export type PaletteHandlers = {
	onAdd: (tag: string) => void;
	onExport: () => void;
	onDelete: () => void;
	onGroup: () => void;
	onUngroup: () => void;
	// Returns the new camera mode label ("Free" / "Orbit") so we can show it. Omitted
	// when the scene has no <scene-camera> to drive — then we hide the camera button.
	onToggleCamera?: () => string;
	onField: (field: InspectorField, axis: number, value: number) => void;
};

// The transform the inspector reflects. `visible` is false when zero or many blocks
// are selected — the panel only makes sense for a single block — and `sized` is
// false for a group, which has no size of its own and greys out the size row.
export type InspectorState = {
	visible: boolean;
	position: readonly [number, number, number];
	rotation: readonly [number, number, number];
	size: readonly [number, number, number];
	sized: boolean;
};

// The host element with its two editor-supplied props typed on.
export interface ScenePaletteElement extends BaseComponent {
	handlers?: PaletteHandlers;
	inspector?: InspectorState;
}

customElements.define(
	"scene-palette",
	render(function* (element) {
		const host = element as ScenePaletteElement;
		// Handlers arrive as a JS property before we mount, and never change — read
		// them once rather than on every render.
		const { handlers } = props(host, { handlers: Object }) as {
			handlers: PaletteHandlers;
		};

		// The camera button is the one bit of local state: the mode label the toggle
		// returns. We hold it here and re-render on toggle (update()), instead of
		// writing the button's text imperatively.
		let cameraLabel = "Free";

		// One delegated click listener for the whole toolbar, dispatching on the
		// data-* attributes the buttons carry — the same shape as before, now wired
		// through a template binding instead of addEventListener.
		const onClick = (event: Event): void => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const addTag = target.dataset.add;
			if (addTag !== undefined) {
				handlers.onAdd(addTag);
				return;
			}
			switch (target.dataset.action) {
				case "export":
					handlers.onExport();
					break;
				case "delete":
					handlers.onDelete();
					break;
				case "group":
					handlers.onGroup();
					break;
				case "ungroup":
					handlers.onUngroup();
					break;
				case "camera":
					if (handlers.onToggleCamera === undefined) break;
					cameraLabel = handlers.onToggleCamera();
					void host.update();
					break;
			}
		};

		// One delegated input listener for the inspector. Position and rotation take
		// any value; only size must stay positive.
		const onInput = (event: Event): void => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement)) return;
			const field = target.dataset.field as InspectorField | undefined;
			const axis = target.dataset.axis;
			if (field === undefined || axis === undefined) return;
			const value = Number(target.value);
			if (Number.isNaN(value)) return;
			if (field === "size" && value <= 0) return;
			handlers.onField(field, Number(axis), value);
		};

		yield () => {
			const inspector = host.inspector;
			const sized = inspector?.sized ?? false;
			// The concrete input value for a field/axis, or empty while nothing is
			// selected (the panel is hidden then, so the value is never seen).
			const fieldValue = (field: InspectorField, axis: number): string =>
				inspector ? String(inspector[field][axis]) : "";

			return html`
				<style>
					:host {
						position: absolute;
						top: 12px;
						left: 12px;
						z-index: 1;
					}
					.palette {
						display: flex;
						flex-direction: column;
						gap: 6px;
						padding: 8px;
						border-radius: 10px;
						background: rgba(20, 22, 28, 0.85);
						border: 1px solid rgba(255, 255, 255, 0.12);
						backdrop-filter: blur(6px);
					}
					.row {
						display: flex;
						gap: 6px;
						flex-wrap: wrap;
						align-items: center;
					}
					button {
						font:
							600 12px/1 system-ui,
							sans-serif;
						color: #f5f5f5;
						background: rgba(255, 255, 255, 0.08);
						border: 1px solid rgba(255, 255, 255, 0.18);
						border-radius: 6px;
						padding: 6px 9px;
						cursor: pointer;
					}
					button:hover {
						background: rgba(255, 255, 255, 0.16);
					}
					.spacer {
						width: 1px;
						align-self: stretch;
						background: rgba(255, 255, 255, 0.18);
						margin: 0 2px;
					}
					.inspector {
						display: flex;
						flex-direction: column;
						gap: 4px;
					}
					.field-row {
						gap: 4px;
						color: rgba(255, 255, 255, 0.75);
						font:
							600 11px/1 system-ui,
							sans-serif;
					}
					.field-row > span {
						width: 30px;
					}
					.field-row input {
						width: 48px;
						font:
							600 11px/1 system-ui,
							sans-serif;
						color: #f5f5f5;
						background: rgba(255, 255, 255, 0.08);
						border: 1px solid rgba(255, 255, 255, 0.18);
						border-radius: 5px;
						padding: 4px 5px;
					}
					.field-row input:disabled {
						opacity: 0.4;
						cursor: not-allowed;
					}
				</style>
				<div class="palette" onclick="${onClick}" oninput="${onInput}">
					<div class="row">
						<button data-add="scene-cube">+ Cube</button>
						<button data-add="scene-wall">+ Wall</button>
						<button data-add="scene-ramp">+ Ramp</button>
						<span class="spacer"></span>
						<button data-action="group">Group</button>
						<button data-action="ungroup">Ungroup</button>
						<button data-action="delete">Delete</button>
						<span class="spacer"></span>
						${handlers.onToggleCamera
							? html`<button data-action="camera">
									Camera: ${cameraLabel}
								</button>`
							: null}
						<button data-action="export">Export</button>
					</div>
					<div
						class="inspector"
						style="${inspector?.visible ? "" : "display:none"}"
					>
						<div class="row field-row">
							<span>Pos</span>
							<input
								type="number"
								step="0.5"
								data-field="position"
								data-axis="0"
								title="x"
								value="${fieldValue("position", 0)}"
							/>
							<input
								type="number"
								step="0.5"
								data-field="position"
								data-axis="1"
								title="y"
								value="${fieldValue("position", 1)}"
							/>
							<input
								type="number"
								step="0.5"
								data-field="position"
								data-axis="2"
								title="z"
								value="${fieldValue("position", 2)}"
							/>
						</div>
						<div class="row field-row">
							<span>Rot</span>
							<input
								type="number"
								step="15"
								data-field="rotation"
								data-axis="0"
								title="rotate-x"
								value="${fieldValue("rotation", 0)}"
							/>
							<input
								type="number"
								step="15"
								data-field="rotation"
								data-axis="1"
								title="rotate-y"
								value="${fieldValue("rotation", 1)}"
							/>
							<input
								type="number"
								step="15"
								data-field="rotation"
								data-axis="2"
								title="rotate-z"
								value="${fieldValue("rotation", 2)}"
							/>
						</div>
						<div class="row field-row">
							<span>Size</span>
							<input
								type="number"
								step="0.5"
								min="0.1"
								data-field="size"
								data-axis="0"
								title="width"
								value="${fieldValue("size", 0)}"
								${sized ? "" : "disabled"}
							/>
							<input
								type="number"
								step="0.5"
								min="0.1"
								data-field="size"
								data-axis="1"
								title="height"
								value="${fieldValue("size", 1)}"
								${sized ? "" : "disabled"}
							/>
							<input
								type="number"
								step="0.5"
								min="0.1"
								data-field="size"
								data-axis="2"
								title="depth"
								value="${fieldValue("size", 2)}"
								${sized ? "" : "disabled"}
							/>
						</div>
					</div>
				</div>
			`;
		};
	}),
);
