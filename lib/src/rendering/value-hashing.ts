import { getParsedTemplate } from "../parser/html";
import { isTemplate, TemplateValue } from "../template";
import {
	FIRST_LANE_SEED,
	hashOfLanes,
	highWordOf,
	lowWordOf,
	mixTextIntoLanes,
	mixWordIntoLanes,
	SECOND_LANE_SEED,
} from "../utils/hashing";
import { assertDuringDevelopment, libraryMessage } from "../utils/diagnostics";
import * as TAG from "./value-hashing-tag";

const HASH_DEPTH_LIMIT = 64;
const HASH_VISIT_LIMIT = 1_000_000;
const NOT_AN_ANCESTOR = -1;
//every value starts with a word holding its tag in the top byte and, for the counted kinds, a count
//below 2^24 in the rest, so the words of two different values never read the same
const TAG_SHIFT = 24;
const PAYLOAD_MASK = 2 ** TAG_SHIFT - 1;
const SMALL_INTEGER_LIMIT = 2 ** (TAG_SHIFT - 1);

interface ValueWalk {
	containersOnPath: Array<{} | null>;
	visitCount: number;
	floatView: Float64Array;
	floatWordsView: Int32Array;
}

const createValueWalk = (): ValueWalk => {
	const floatView = new Float64Array(1);
	return {
		containersOnPath: new Array(HASH_DEPTH_LIMIT).fill(null),
		visitCount: 0,
		floatView,
		floatWordsView: new Int32Array(floatView.buffer),
	};
};

//one walk runs at a time, so one serves every walk. Its path is cleared on the way out, also by a
//throw, so no paint's data outlives its walk
const walk = createValueWalk();
//kept out of the walk: read through a field, the lanes made a 10k-object walk 15 % slower in Chromium
const walkLanes = new Int32Array(2);

interface ReferenceRegistry {
	idsByReference: WeakMap<Object, number>;
	//held strongly, because a WeakMap refuses a Symbol.for symbol and, before Firefox 146, every
	//symbol; each distinct symbol a walk meets stays registered
	idsBySymbol: Map<symbol, number>;
	referenceRegistrationCount: number;
}

const createReferenceRegistry = (): ReferenceRegistry => ({
	idsByReference: new WeakMap(),
	idsBySymbol: new Map(),
	referenceRegistrationCount: 0,
});

//one for the program: reference ids must stay stable across every paint
const referenceRegistry = createReferenceRegistry();

const referenceId = (value: Object): number => {
	let id = referenceRegistry.idsByReference.get(value);
	if (id === undefined) {
		referenceRegistry.referenceRegistrationCount++;
		id = referenceRegistry.referenceRegistrationCount;
		referenceRegistry.idsByReference.set(value, id);
	}
	return id;
};

const symbolId = (value: symbol): number => {
	let id = referenceRegistry.idsBySymbol.get(value);
	if (id === undefined) {
		referenceRegistry.referenceRegistrationCount++;
		id = referenceRegistry.referenceRegistrationCount;
		referenceRegistry.idsBySymbol.set(value, id);
	}
	return id;
};

const countWalkVisit = (): void => {
	walk.visitCount++;
	if (walk.visitCount <= HASH_VISIT_LIMIT) return;
	throw new Error(
		libraryMessage(
			`comparing a value visited more than ${HASH_VISIT_LIMIT} objects and arrays: it is that large, or it reaches the same ones again and again, the way a graph does. Pass it inside a class instance, which is compared by reference, and assign a new instance when it changes.`,
		),
	);
};

const ancestorDistanceOf = (container: {}, depth: number): number => {
	for (let index = depth - 1; index >= 0; index--)
		if (walk.containersOnPath[index] === container) return depth - index;
	return NOT_AN_ANCESTOR;
};

const mixReferenceIntoWalk = (id: number): void => {
	mixWordIntoLanes(walkLanes, TAG.REFERENCE << TAG_SHIFT);
	mixWordIntoLanes(walkLanes, id);
};

const mixNumberIntoWalk = (numberValue: number): void => {
	if (numberValue === (numberValue | 0)) {
		const fitsBesideTag =
			numberValue >= -SMALL_INTEGER_LIMIT && numberValue < SMALL_INTEGER_LIMIT;
		if (fitsBesideTag) {
			mixWordIntoLanes(
				walkLanes,
				(TAG.SMALL_INTEGER << TAG_SHIFT) | (numberValue & PAYLOAD_MASK),
			);
			return;
		}
		mixWordIntoLanes(walkLanes, TAG.INTEGER << TAG_SHIFT);
		mixWordIntoLanes(walkLanes, numberValue);
		return;
	}
	walk.floatView[0] = numberValue;
	mixWordIntoLanes(walkLanes, TAG.FLOAT << TAG_SHIFT);
	mixWordIntoLanes(walkLanes, walk.floatWordsView[0]);
	mixWordIntoLanes(walkLanes, walk.floatWordsView[1]);
};

//a template adds no level: nesting templates is written in source, and a cycle through one still
//passes a container that does
const walkTemplate = (value: TemplateValue, depth: number): void => {
	countWalkVisit();
	const { templateHash } = getParsedTemplate(value.__templateStrings);
	mixWordIntoLanes(
		walkLanes,
		(TAG.TEMPLATE << TAG_SHIFT) | value.values.length,
	);
	mixWordIntoLanes(walkLanes, lowWordOf(templateHash));
	mixWordIntoLanes(walkLanes, highWordOf(templateHash));
	for (let index = 0; index < value.values.length; index++)
		walkValue(value.values[index], depth);
};

//exact constructors: subclasses and null-prototype objects are hashed by reference
const isPlainObject = (value: {}): value is Record<string, unknown> =>
	value.constructor === Object;
const isExactlyMap = (value: {}): value is Map<unknown, unknown> =>
	value.constructor === Map;
const isExactlySet = (value: {}): value is Set<unknown> =>
	value.constructor === Set;

const walkContainerContents = (container: {}, childDepth: number): void => {
	if (Array.isArray(container)) {
		mixWordIntoLanes(walkLanes, (TAG.ARRAY << TAG_SHIFT) | container.length);
		for (let index = 0; index < container.length; index++)
			walkValue(container[index], childDepth);
		return;
	}

	if (isPlainObject(container)) {
		mixWordIntoLanes(walkLanes, TAG.OBJECT << TAG_SHIFT);
		for (const name in container) {
			mixTextIntoLanes(
				walkLanes,
				(TAG.STRING << TAG_SHIFT) | name.length,
				name,
			);
			walkValue(container[name], childDepth);
		}
		mixWordIntoLanes(walkLanes, TAG.OBJECT_END << TAG_SHIFT);
		return;
	}

	if (isExactlyMap(container)) {
		mixWordIntoLanes(walkLanes, (TAG.MAP << TAG_SHIFT) | container.size);
		for (const key of container.keys()) {
			walkValue(key, childDepth);
			walkValue(container.get(key), childDepth);
		}
		return;
	}

	assertDuringDevelopment(
		isExactlySet(container),
		"a walked container is an array, a plain object, a Map or a Set",
	);
	mixWordIntoLanes(walkLanes, (TAG.SET << TAG_SHIFT) | container.size);
	for (const member of container) walkValue(member, childDepth);
};

const walkObject = (value: object, depth: number): void => {
	if (isTemplate(value)) {
		walkTemplate(value, depth);
		return;
	}
	if (depth >= HASH_DEPTH_LIMIT) {
		mixWordIntoLanes(walkLanes, TAG.TRUNCATED << TAG_SHIFT);
		return;
	}
	const isWalkedContainer =
		Array.isArray(value) ||
		isPlainObject(value) ||
		isExactlyMap(value) ||
		isExactlySet(value);
	//walking class instances, Date, typed arrays and null-prototype objects costs every paint for
	//values that are rarely mutated in place; an in-place change to one of them is not noticed
	if (!isWalkedContainer) {
		mixReferenceIntoWalk(referenceId(value));
		return;
	}
	const ancestorDistance = ancestorDistanceOf(value, depth);
	//the ancestor's own walk already covers these contents
	if (ancestorDistance !== NOT_AN_ANCESTOR) {
		mixWordIntoLanes(walkLanes, (TAG.ANCESTOR << TAG_SHIFT) | ancestorDistance);
		return;
	}
	countWalkVisit();
	walk.containersOnPath[depth] = value;
	walkContainerContents(value, depth + 1);
	walk.containersOnPath[depth] = null;
};

const walkValue = (value: unknown, depth: number): void => {
	switch (typeof value) {
		case "string":
			mixTextIntoLanes(
				walkLanes,
				(TAG.STRING << TAG_SHIFT) | value.length,
				value,
			);
			return;
		case "number":
			mixNumberIntoWalk(value);
			return;
		case "boolean":
			mixWordIntoLanes(walkLanes, (TAG.BOOLEAN << TAG_SHIFT) | (value ? 1 : 0));
			return;
		case "undefined":
			mixWordIntoLanes(walkLanes, TAG.NULLISH << TAG_SHIFT);
			return;
		case "bigint": {
			const digits = String(value);
			mixTextIntoLanes(
				walkLanes,
				(TAG.BIGINT << TAG_SHIFT) | digits.length,
				digits,
			);
			return;
		}
		case "function":
			mixReferenceIntoWalk(referenceId(value));
			return;
		case "symbol":
			mixReferenceIntoWalk(symbolId(value));
			return;
		case "object":
			if (value === null) mixWordIntoLanes(walkLanes, TAG.NULLISH << TAG_SHIFT);
			else walkObject(value, depth);
	}
};

//every value's words go into the same two lanes, so nothing is allocated per value and no nested
//hash is fed back in, where it could cancel its parent's part
export const hashValue = (value: unknown): number => {
	walkLanes[0] = FIRST_LANE_SEED;
	walkLanes[1] = SECOND_LANE_SEED;
	walk.visitCount = 0;
	try {
		walkValue(value, 0);
	} catch (error) {
		walk.containersOnPath.fill(null);
		throw error;
	}
	return hashOfLanes(walkLanes[0], walkLanes[1]);
};
