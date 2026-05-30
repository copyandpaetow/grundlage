// Shared geometry constants and the attribute → variable bridge helpers for the
// DOM-as-geometry scene. Both <scene-world> and <scene-cube> lean on this module
// so the two state channels stay consistent: attributes are the committed,
// authored, serializable state; CSS variables are the in-flight render state.

// Pixels of screen space one authored grid unit occupies. The unit-cube geometry
// is laid out once at this size; every dimension after that is scale3d over it.
export const UNIT_SIZE = 120;

// Authoring grid resolution in grid units. Direct manipulation commits snap to
// this so dragged blocks land on a regular lattice instead of arbitrary floats.
export const GRID_SNAP = 0.5;

// Snap a continuous grid value onto the authoring lattice.
export const snapToGrid = (value: number): number =>
	Math.round(value / GRID_SNAP) * GRID_SNAP;

// Format a number for serialized attributes: drop trailing zeros so exported
// markup reads `2` and `1.5`, never `2.000000001` or `1.50`.
export const formatNumber = (value: number): string => {
	const rounded = Math.round(value * 1000) / 1000;
	return Object.is(rounded, -0) ? "0" : String(rounded);
};

// Camera state lives in typed, registered custom properties on the document root.
// Keeping them on :root (not on a custom element) is deliberate: a camera move is
// then a pure variable write the compositor consumes through the cascade, and it
// never mutates a component's attributes, so it never triggers a re-render.
const CAMERA_PROPERTY_RULES = /*css*/ `
  @property --camera-perspective {
    syntax: "<length>";
    inherits: true;
    initial-value: 800px;
  }
  @property --camera-x {
    syntax: "<length>";
    inherits: true;
    initial-value: 0px;
  }
  @property --camera-y {
    syntax: "<length>";
    inherits: true;
    initial-value: 0px;
  }
  @property --camera-z {
    syntax: "<length>";
    inherits: true;
    initial-value: 600px;
  }
  @property --camera-yaw {
    syntax: "<angle>";
    inherits: true;
    initial-value: 0deg;
  }
  @property --camera-pitch {
    syntax: "<angle>";
    inherits: true;
    initial-value: 0deg;
  }
`;

let cameraPropertiesInstalled = false;

// We register the camera properties once per document. Guarded so repeated
// <scene-world> upgrades (or hydration) don't append duplicate stylesheets.
export const installCameraProperties = (): void => {
	if (cameraPropertiesInstalled || typeof document === "undefined") return;
	cameraPropertiesInstalled = true;
	const propertyStyle = document.createElement("style");
	propertyStyle.textContent = CAMERA_PROPERTY_RULES;
	document.head.appendChild(propertyStyle);
};

const parseNumberList = (raw: string | null): number[] => {
	if (raw === null) return [];
	return raw
		.trim()
		.split(/\s+/)
		.filter((token) => token !== "")
		.map(Number);
};

// Resolve one axis triple (e.g. `size` → width/height/depth) following the
// plan's precedence: the shorthand seeds all three axes, and a specific
// attribute overrides its own axis when present. A single shorthand value
// applies to every axis; three values map to x/y/z in order. We resolve this in
// JS so CSS only ever sees the concrete --block-* channel, never the shorthand.
export const resolveTriple = (
	element: Element,
	shorthand: string,
	specific: readonly [string, string, string],
	fallback: number,
): [number, number, number] => {
	const shorthandValues = parseNumberList(element.getAttribute(shorthand));

	const seedForAxis = (axis: number): number => {
		if (shorthandValues.length === 1) return shorthandValues[0];
		if (axis < shorthandValues.length) return shorthandValues[axis];
		return fallback;
	};

	const resolveAxis = (axis: number): number => {
		const specificRaw = element.getAttribute(specific[axis]);
		if (specificRaw !== null && specificRaw.trim() !== "") {
			const parsed = Number(specificRaw);
			if (!Number.isNaN(parsed)) return parsed;
		}
		return seedForAxis(axis);
	};

	return [resolveAxis(0), resolveAxis(1), resolveAxis(2)];
};
