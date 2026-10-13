/*
    Synthetic templates for the render bench.

    Each shape isolates one binding lane so a commit-path change has a row that
    moves and rows that must not. The unit is one live-binding commit, not one
    hole: the composed-name lane spends two values on one binding and would
    otherwise read half price.

    Churn is the second axis, and it is the one the gate hash makes interesting.
    combinedPartsHash runs BEFORE claimHashChange, so an unchanged binding still
    walks its nameParts and still pays for the walk. "unchanged" is that tax with
    nothing else in it; "changing" adds compose plus the write.
*/

export type CommitLane =
	| "staticNameAttribute"
	| "composedNameAttribute"
	| "customElementAttribute"
	| "declaredPropAttribute"
	| "attributeSpread"
	| "content";

export type ValueChurn = "changing" | "unchanged";

export interface CommitShape {
	name: string;
	lane: CommitLane;
	churn: ValueChurn;
	hypothesis: string;
	bindingsPerTemplate: number;
}

export interface GeneratedShape {
	shape: CommitShape;
	templateStrings: TemplateStringsArray;
	/** Alternated per update so every commit sees a value the last one did not. */
	valuesByParity: [Array<unknown>, Array<unknown>];
}

/*
    A plain custom element, not a grundlage component: assignDeclaredProp on a
    component would schedule a render per binding per commit and the pass would
    be measuring the driver. declaredPropNames is the only thing the write path
    reads off the constructor.
*/
export const PLAIN_CUSTOM_ELEMENT_NAME = "probe-plain";
export const DECLARED_PROP_ELEMENT_NAME = "probe-declared";
export const DECLARED_PROP_NAME = "payload";

export const defineProbeElements = (): void => {
	if (customElements.get(PLAIN_CUSTOM_ELEMENT_NAME)) return;
	customElements.define(
		PLAIN_CUSTOM_ELEMENT_NAME,
		class extends HTMLElement {},
	);
	customElements.define(
		DECLARED_PROP_ELEMENT_NAME,
		class extends HTMLElement {
			static declaredPropNames: ReadonlySet<string> = new Set([
				DECLARED_PROP_NAME,
			]);
		},
	);
};

const asTemplateStringsArray = (
	parts: ReadonlyArray<string>,
): TemplateStringsArray =>
	Object.assign(parts.slice(), {
		raw: parts.slice(),
	}) as unknown as TemplateStringsArray;

/*
    Values are strings of a few characters. hashValue walks every character, so
    a long value would move cost out of the lane being measured and into the
    hash, and every lane would drift toward the same number.
*/
const attributeValueFor = (index: number, parity: number): string =>
	`v${index}${parity}`;

interface LaneMarkup {
	/** literal chunks, one longer than the value count */
	strings: Array<string>;
	valuesFor: (parity: number) => Array<unknown>;
}

/** One element per binding: open, close, open, close, … with the holes between. */
const repeatOneElementPerBinding = (
	openAt: (index: number) => string,
	close: string,
	bindings: number,
): Array<string> => {
	const strings: Array<string> = [];
	for (let index = 0; index < bindings; index++)
		strings.push(index === 0 ? openAt(index) : close + openAt(index));
	strings.push(close);
	return strings;
};

const oneValuePerBinding =
	(bindings: number) =>
	(parity: number): Array<unknown> =>
		Array.from({ length: bindings }, (_, index) =>
			attributeValueFor(index, parity),
		);

const singleValueAttributeMarkup = (
	tagName: string,
	attributeNameAt: (index: number) => string,
	bindings: number,
): LaneMarkup => ({
	strings: repeatOneElementPerBinding(
		(index) => `<${tagName} ${attributeNameAt(index)}="`,
		`"></${tagName}>`,
		bindings,
	),
	valuesFor: oneValuePerBinding(bindings),
});

/*
    The name hole is handed the same string on both parities. Only the value
    moves, so this lane and staticNameAttribute differ by exactly one thing:
    whether nameParts carries a hole.
*/
const composedNameMarkup = (bindings: number): LaneMarkup => {
	const strings: Array<string> = [];
	for (let index = 0; index < bindings; index++) {
		strings.push(index === 0 ? `<div data-` : `"></div><div data-`);
		strings.push(`="`);
	}
	strings.push(`"></div>`);
	return {
		strings,
		valuesFor: (parity) => {
			const values: Array<unknown> = [];
			for (let index = 0; index < bindings; index++) {
				values.push(`slot${index}`);
				values.push(attributeValueFor(index, parity));
			}
			return values;
		},
	};
};

const SPREAD_KEYS = ["data-one", "data-two", "data-three", "data-four"];

const attributeSpreadMarkup = (bindings: number): LaneMarkup => ({
	strings: repeatOneElementPerBinding(() => `<div `, `></div>`, bindings),
	valuesFor: (parity) =>
		Array.from({ length: bindings }, (_, index) => {
			const bag: Record<string, string> = {};
			for (let key = 0; key < SPREAD_KEYS.length; key++)
				bag[SPREAD_KEYS[key]] = attributeValueFor(
					index * SPREAD_KEYS.length + key,
					parity,
				);
			return bag;
		}),
});

const contentMarkup = (bindings: number): LaneMarkup => ({
	strings: repeatOneElementPerBinding(() => `<div>`, `</div>`, bindings),
	valuesFor: oneValuePerBinding(bindings),
});

const markupForLane = (lane: CommitLane, bindings: number): LaneMarkup => {
	switch (lane) {
		case "staticNameAttribute":
			return singleValueAttributeMarkup(
				"div",
				(index) => `data-slot${index}`,
				bindings,
			);
		case "customElementAttribute":
			return singleValueAttributeMarkup(
				PLAIN_CUSTOM_ELEMENT_NAME,
				(index) => `data-slot${index}`,
				bindings,
			);
		case "declaredPropAttribute":
			return singleValueAttributeMarkup(
				DECLARED_PROP_ELEMENT_NAME,
				() => DECLARED_PROP_NAME,
				bindings,
			);
		case "composedNameAttribute":
			return composedNameMarkup(bindings);
		case "attributeSpread":
			return attributeSpreadMarkup(bindings);
		case "content":
			return contentMarkup(bindings);
	}
};

export const generateShape = (shape: CommitShape): GeneratedShape => {
	const markup = markupForLane(shape.lane, shape.bindingsPerTemplate);
	const first = markup.valuesFor(0);
	return {
		shape,
		templateStrings: asTemplateStringsArray(markup.strings),
		valuesByParity:
			shape.churn === "unchanged"
				? [first, first]
				: [first, markup.valuesFor(1)],
	};
};

// --- shapes ---------------------------------------------------------------

const BINDINGS_PER_TEMPLATE = 400;

const LANE_HYPOTHESES: Record<CommitLane, string> = {
	staticNameAttribute:
		"the common attribute: one hole, a name with none. P13's subject",
	composedNameAttribute:
		"the same commit with a hole in the name. The gap to staticName is what a hole-free walk is worth",
	customElementAttribute:
		"staticName on a defined custom element. The gap is the customElements.get B4 wants to cache",
	declaredPropAttribute:
		"isDeclaredPropName answers yes and the write leaves the attribute path entirely",
	attributeSpread:
		"one binding, four keys: normalize to a Map and diff it every commit",
	content: "a text hole. No name, no compose, no attribute write: the floor",
};

const shapeFor = (lane: CommitLane, churn: ValueChurn): CommitShape => ({
	name: `${lane} · ${churn}`,
	lane,
	churn,
	hypothesis: LANE_HYPOTHESES[lane],
	bindingsPerTemplate: BINDINGS_PER_TEMPLATE,
});

const LANES_IN_ORDER: Array<CommitLane> = [
	"content",
	"staticNameAttribute",
	"composedNameAttribute",
	"customElementAttribute",
	"declaredPropAttribute",
	"attributeSpread",
];

export const COMMIT_SHAPES: Array<CommitShape> = LANES_IN_ORDER.flatMap(
	(lane) => [shapeFor(lane, "unchanged"), shapeFor(lane, "changing")],
);
