import { html, prop, type Resolve, type Template } from "../../../lib/src";
import { UNIT_SIZE } from "./unit-size";

//Attributes are the committed, serializable state; --position-*, --rotation-* and
//--size-* carry raw numbers, and CSS does the arithmetic.

export { UNIT_SIZE };
export const HALF_UNIT = UNIT_SIZE / 2;
export const GRID_SNAP = 0.5;

export const GROUND_HALF_UNITS = 20;
export const GROUND_SIZE = GROUND_HALF_UNITS * 2 * UNIT_SIZE;

export type Vector3 = [number, number, number];

export const snapToGrid = (value: number): number => Math.round(value / GRID_SNAP) * GRID_SNAP;

//Exported markup reads `2` and `1.5`, never `2.000000001`, `1.50` or `-0`.
export const formatNumber = (value: number): string => {
	const rounded = Math.round(value * 1000) / 1000;
	return Object.is(rounded, -0) ? "0" : String(rounded);
};

//Non-inheriting: inherited, a group's rotation would apply to each member twice
const registeredProperties: PropertyDefinition[] = [
	{
		name: "--unit",
		syntax: "<length>",
		inherits: true,
		initialValue: `${UNIT_SIZE}px`,
	},
	...["x", "y", "z"].flatMap((axis) => [
		{
			name: `--position-${axis}`,
			syntax: "<number>",
			inherits: false,
			initialValue: "0",
		},
		{
			name: `--rotation-${axis}`,
			syntax: "<number>",
			inherits: false,
			initialValue: "0",
		},
		{
			name: `--size-${axis}`,
			syntax: "<number>",
			inherits: false,
			initialValue: "1",
		},
		//Bounds read these back as px, which an unregistered calc() would never resolve to
		{
			name: `--block-extent-${axis}`,
			syntax: "<length>",
			inherits: false,
			initialValue: "0px",
		},
	]),
];
export const registerProperties = (definitions: PropertyDefinition[]): void => {
	for (const definition of definitions) {
		try {
			CSS.registerProperty(definition);
		} catch {
			//A hot reload evaluates this module again, and the first registration stands
		}
	}
};
registerProperties(registeredProperties);

//Author +Y is up and screen +Y is down; Y is negated here and nowhere else
export const placementStyles = html`
	<style>
		:host {
			position: absolute;
			top: 50%;
			left: 50%;
			transform-style: preserve-3d;
			--placement: translate3d(
					calc(var(--position-x) * var(--unit)),
					calc(var(--position-y) * var(--unit) * -1),
					calc(var(--position-z) * var(--unit))
				)
				rotateX(calc(var(--rotation-x) * 1deg))
				rotateY(calc(var(--rotation-y) * 1deg))
				rotateZ(calc(var(--rotation-z) * 1deg));
			transform: var(--placement);
		}
		/* Size scales only the faces, so slotted children keep the world grid */
		.body {
			position: absolute;
			transform-style: preserve-3d;
			transform: scale3d(var(--size-x), var(--size-y), var(--size-z));
		}
	</style>
`;

export const placementVariables = ({ position, rotation, size }: BlockTransform): Template => html`
	<style>
		:host {
			--position-x: ${position[0]};
			--position-y: ${position[1]};
			--position-z: ${position[2]};
			--rotation-x: ${rotation[0]};
			--rotation-y: ${rotation[1]};
			--rotation-z: ${rotation[2]};
			--size-x: ${size[0]};
			--size-y: ${size[1]};
			--size-z: ${size[2]};
		}
	</style>
`;

//The size does not inherit, so the body gets its own copy of the host's; pulled down with
//`inherit` instead, WebKit never re-resolves the scale when the size changes
export const bodySizeVariables = ([sizeX, sizeY, sizeZ]: Vector3): string =>
	`--size-x: ${sizeX}; --size-y: ${sizeY}; --size-z: ${sizeZ};`;

//Never refuses, so malformed markup keeps the element rendering
const asTriple =
	(fallback: number): Resolve<Vector3> =>
	(incoming) => {
		if (Array.isArray(incoming)) {
			return [incoming[0] ?? fallback, incoming[1] ?? fallback, incoming[2] ?? fallback];
		}
		const values = String(incoming)
			.trim()
			.split(/\s+/)
			.filter((token) => token !== "")
			.map(Number);
		if (values.length === 1) return [values[0], values[0], values[0]];
		return [values[0] ?? fallback, values[1] ?? fallback, values[2] ?? fallback];
	};

const asSizeTriple = asTriple(1);
const asOriginTriple = asTriple(0);

const sizeProps = {
	size: prop.attribute(asSizeTriple, [1, 1, 1]),
	width: prop.optional(prop.attribute(Number)),
	height: prop.optional(prop.attribute(Number)),
	depth: prop.optional(prop.attribute(Number)),
};

const positionProps = {
	position: prop.attribute(asOriginTriple, [0, 0, 0]),
	x: prop.optional(prop.attribute(Number)),
	y: prop.optional(prop.attribute(Number)),
	z: prop.optional(prop.attribute(Number)),
};

const rotationProps = {
	rotation: prop.attribute(asOriginTriple, [0, 0, 0]),
	"rotate-x": prop.optional(prop.attribute(Number)),
	"rotate-y": prop.optional(prop.attribute(Number)),
	"rotate-z": prop.optional(prop.attribute(Number)),
};

//Declared, so the editor's setAttribute re-renders the element without driving it
export const geometryProps = {
	...sizeProps,
	...positionProps,
	...rotationProps,
};

export const carrierProps = {
	...positionProps,
	...rotationProps,
};

export const ghostProps = { ...positionProps };

export type BlockTransform = {
	size: Vector3;
	position: Vector3;
	rotation: Vector3;
};

type TransformProps = {
	readonly size?: Vector3;
	readonly width?: number;
	readonly height?: number;
	readonly depth?: number;
	readonly position?: Vector3;
	readonly x?: number;
	readonly y?: number;
	readonly z?: number;
	readonly rotation?: Vector3;
	readonly "rotate-x"?: number;
	readonly "rotate-y"?: number;
	readonly "rotate-z"?: number;
};

const resolveTriple = (
	shorthand: Vector3 | undefined,
	alongX: number | undefined,
	alongY: number | undefined,
	alongZ: number | undefined,
	fallback: number,
): Vector3 => {
	const seed = shorthand ?? [fallback, fallback, fallback];
	return [alongX ?? seed[0], alongY ?? seed[1], alongZ ?? seed[2]];
};

export const blockTransformFromProps = (props: TransformProps): BlockTransform => ({
	size: resolveTriple(props.size, props.width, props.height, props.depth, 1),
	position: resolveTriple(props.position, props.x, props.y, props.z, 0),
	rotation: resolveTriple(
		props.rotation,
		props["rotate-x"],
		props["rotate-y"],
		props["rotate-z"],
		0,
	),
});

const readTriple = (parse: Resolve<Vector3>, element: Element, name: string): Vector3 =>
	parse(element.getAttribute(name) ?? "") as Vector3;

const readNumber = (element: Element, name: string): number | undefined => {
	const raw = element.getAttribute(name);
	if (raw === null || raw.trim() === "") return undefined;
	const parsed = Number(raw);
	return Number.isNaN(parsed) ? undefined : parsed;
};

//The editor authors markup, so it resolves transforms straight off attributes and
//works on elements whose definition never loaded.
export const blockTransformFromAttributes = (element: Element): BlockTransform =>
	blockTransformFromProps({
		size: readTriple(asSizeTriple, element, "size"),
		width: readNumber(element, "width"),
		height: readNumber(element, "height"),
		depth: readNumber(element, "depth"),
		position: readTriple(asOriginTriple, element, "position"),
		x: readNumber(element, "x"),
		y: readNumber(element, "y"),
		z: readNumber(element, "z"),
		rotation: readTriple(asOriginTriple, element, "rotation"),
		"rotate-x": readNumber(element, "rotate-x"),
		"rotate-y": readNumber(element, "rotate-y"),
		"rotate-z": readNumber(element, "rotate-z"),
	});

//The per-axis attributes an edit to a shorthand has to clear.
export const SIZE_SPECIFIC = ["width", "height", "depth"] as const;
export const POSITION_SPECIFIC = ["x", "y", "z"] as const;
export const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;

//Joins the render an attribute write scheduled, or starts one for a content change,
//so a following measure sees the committed state
export const sceneElementRendered = (element: HTMLElement): Promise<void> => {
	const update = (element as Partial<{ update: () => Promise<void> }>).update;
	return typeof update === "function" ? update.call(element) : Promise.resolve();
};
