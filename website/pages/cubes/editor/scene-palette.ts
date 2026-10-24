import { html, component, prop } from "../../../../lib/src";

// <scene-palette> — the editor's 2D chrome: the toolbar and the transform inspector. It
// is pure presentation and owns no editor state: the editor renders it with an
// `inspector` snapshot and a `cameraMode`, and it answers with one `palette-command`
// event per intent.

export type InspectorField = "position" | "rotation" | "size";

export type CameraMode = "free" | "orbit";

export type PaletteCommand =
	| { kind: "add"; tag: string }
	| { kind: "export" }
	| { kind: "delete" }
	| { kind: "group" }
	| { kind: "ungroup" }
	| { kind: "toggle-camera" }
	| { kind: "edit-field"; field: InspectorField; axis: number; value: number };

export type PaletteCommandEvent = CustomEvent<PaletteCommand>;

// Absent while zero or many blocks are selected, which hides the panel. `sized` is false
// for a group, which has no size of its own.
export type InspectorState = {
	position: readonly [number, number, number];
	rotation: readonly [number, number, number];
	size: readonly [number, number, number];
	sized: boolean;
};

// `cameraMode` stays absent when the scene has no <scene-camera>, which hides the button.
const props = {
	inspector: prop.optional(prop.property<InspectorState>()),
	cameraMode: prop.optional(prop.attribute(prop.oneOf("free", "orbit"))),
};

const COMMAND_BY_ACTION: Record<string, PaletteCommand> = {
	export: { kind: "export" },
	delete: { kind: "delete" },
	group: { kind: "group" },
	ungroup: { kind: "ungroup" },
	camera: { kind: "toggle-camera" },
};

const isInspectorField = (value: string | undefined): value is InspectorField =>
	value === "position" || value === "rotation" || value === "size";

customElements.define(
	"scene-palette",
	component(
		function* (componentProps) {
			const { host } = componentProps;

			const sendCommand = (command: PaletteCommand): void => {
				host.dispatchEvent(
					new CustomEvent("palette-command", { detail: command }),
				);
			};

			// One delegated listener for the whole toolbar, dispatching on the buttons' data-*.
			const onClick = (event: Event): void => {
				const target = event.target;
				if (!(target instanceof HTMLElement)) return;
				const addTag = target.dataset.add;
				if (addTag !== undefined) {
					sendCommand({ kind: "add", tag: addTag });
					return;
				}
				const command = COMMAND_BY_ACTION[target.dataset.action ?? ""];
				if (command !== undefined) sendCommand(command);
			};

			// Commits on `change` (Enter, blur, arrows), never per keystroke: the editor echoes a
			// normalized number back, which would rewrite a half-typed "-0.5" or "1.23456".
			// Position and rotation take any value; only size must stay positive.
			const onFieldCommit = (event: Event): void => {
				const target = event.target;
				if (!(target instanceof HTMLInputElement)) return;
				const field = target.dataset.field;
				const axis = target.dataset.axis;
				if (!isInspectorField(field) || axis === undefined) return;
				// An emptied field is NaN here, where Number("") would move the block to 0.
				const value = target.valueAsNumber;
				if (Number.isNaN(value)) return;
				if (field === "size" && value <= 0) return;
				sendCommand({ kind: "edit-field", field, axis: Number(axis), value });
			};

			yield function* view({ inspector, cameraMode }) {
				const sized = inspector?.sized ?? false;
				// Empty while nothing is selected: the panel is hidden then, so it is never seen.
				const fieldValue = (field: InspectorField, axis: number): string =>
					inspector ? String(inspector[field][axis]) : "";

				yield html`
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
					<div class="palette" onClick=${onClick} onChange=${onFieldCommit}>
						<div class="row">
							<button data-add="scene-cube">+ Cube</button>
							<button data-add="scene-wall">+ Wall</button>
							<button data-add="scene-ramp">+ Ramp</button>
							<span class="spacer"></span>
							<button data-action="group">Group</button>
							<button data-action="ungroup">Ungroup</button>
							<button data-action="delete">Delete</button>
							<span class="spacer"></span>
							${
								cameraMode
									? html`<button data-action="camera">
											Camera: ${cameraMode === "orbit" ? "Orbit" : "Free"}
										</button>`
									: null
							}
							<button data-action="export">Export</button>
						</div>
						<div class="inspector" style=${inspector ? "" : "display:none"}>
							<div class="row field-row">
								<span>Pos</span>
								<input
									type="number"
									step="0.5"
									data-field="position"
									data-axis="0"
									title="x"
									value=${fieldValue("position", 0)}
								/>
								<input
									type="number"
									step="0.5"
									data-field="position"
									data-axis="1"
									title="y"
									value=${fieldValue("position", 1)}
								/>
								<input
									type="number"
									step="0.5"
									data-field="position"
									data-axis="2"
									title="z"
									value=${fieldValue("position", 2)}
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
									value=${fieldValue("rotation", 0)}
								/>
								<input
									type="number"
									step="15"
									data-field="rotation"
									data-axis="1"
									title="rotate-y"
									value=${fieldValue("rotation", 1)}
								/>
								<input
									type="number"
									step="15"
									data-field="rotation"
									data-axis="2"
									title="rotate-z"
									value=${fieldValue("rotation", 2)}
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
									value=${fieldValue("size", 0)}
									disabled=${!sized}
								/>
								<input
									type="number"
									step="0.5"
									min="0.1"
									data-field="size"
									data-axis="1"
									title="height"
									value=${fieldValue("size", 1)}
									disabled=${!sized}
								/>
								<input
									type="number"
									step="0.5"
									min="0.1"
									data-field="size"
									data-axis="2"
									title="depth"
									value=${fieldValue("size", 2)}
									disabled=${!sized}
								/>
							</div>
						</div>
					</div>
				`;
			};
		},
		{ props },
	),
);
