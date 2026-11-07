import { expect, test } from "vitest";
import { hashValue } from "../../rendering/value-hashing";
import { html, isTemplate } from "../../template";

//a reference serialization decides which values are equal; two values must hash alike exactly when
//they serialize alike. A chance collision of 53-bit hashes across these inputs has odds near 1e-6,
//so a mismatch is a flaw in how values become words or how words are mixed

const createRandom = (seed: number) => {
	let randomState = seed;
	return (below: number) => {
		randomState = (Math.imul(randomState, 1103515245) + 12345) >>> 0;
		return (randomState >>> 8) % below;
	};
};

//the twin follows the same stream and takes another branch at one decision, so the pair differs by
//one change at any depth
const createTwinRandom = (seed: number, divergingCallIndex: number) => {
	const random = createRandom(seed);
	let callCount = 0;
	return (below: number) => {
		const choice = random(below);
		callCount++;
		if (callCount - 1 !== divergingCallIndex || below < 2) return choice;
		return (choice + 1 + random(below - 1)) % below;
	};
};

class Point {}
const unregisteredSymbol = Symbol("a");
const unregisteredSymbolWithTheSameDescription = Symbol("a");
const firstFunction = () => {};
const secondFunction = () => {};

//values next to the boundaries of the word layout: one-word integers, int32, float halves, tag bytes
const leaves: Array<unknown> = [
	0,
	-0,
	1,
	-1,
	2 ** 23 - 1,
	2 ** 23,
	-(2 ** 23),
	-(2 ** 23) - 1,
	2 ** 31 - 1,
	2 ** 31,
	-(2 ** 31),
	2 ** 32,
	0.5,
	0.25,
	0.1,
	NaN,
	Infinity,
	-Infinity,
	1e21,
	4182,
	423877,
	6 << 24,
	(6 << 24) | 1,
	"",
	"a",
	"b",
	"ab",
	"ba",
	"aa",
	"abc",
	"\u0000",
	"a\u0000",
	"\u0000a",
	"1",
	"true",
	"😀",
	"\ud83d",
	true,
	false,
	null,
	undefined,
	0n,
	1n,
	-1n,
	10n ** 20n,
	Symbol.for("a"),
	Symbol.for("b"),
	unregisteredSymbol,
	unregisteredSymbolWithTheSameDescription,
	firstFunction,
	secondFunction,
	new Point(),
	new Point(),
	Object.create(null),
	new Date(0),
];
const propertyNames = ["a", "b", "ab", "", "0", "1", "length"];
const templates = [
	(values: Array<unknown>) => html`<p>${values[0]}</p>`,
	(values: Array<unknown>) => html`<p>${values[0]}</p>`,
	(values: Array<unknown>) => html`<b>${values[0]}</b>`,
	(values: Array<unknown>) => html`<p>${values[0]}${values[1]}</p>`,
	(values: Array<unknown>) =>
		html`<p>${values[0]}</p>
			${values[1]}`,
];
const DEPTH_LIMIT = 5;

const createContainer = (kind: number) => {
	if (kind <= 2) return [];
	if (kind <= 4) return {};
	if (kind === 5) return new Map();
	return new Set();
};

const generate = (
	random: (below: number) => number,
	depth: number,
	containersOnPath: Array<object>,
): unknown => {
	const kind = random(depth >= DEPTH_LIMIT ? 1 : 8);
	if (kind === 0) return leaves[random(leaves.length)];
	const isBackReference = containersOnPath.length > 0 && random(6) === 0;
	if (isBackReference) return containersOnPath[random(containersOnPath.length)];
	const childOf = () => generate(random, depth + 1, containersOnPath);
	if (kind === 7) return templates[random(templates.length)]([childOf(), childOf()]);
	const container = createContainer(kind);
	containersOnPath.push(container);
	const childCount = random(4);
	for (let index = 0; index < childCount; index++) {
		if (Array.isArray(container)) container.push(childOf());
		else if (container instanceof Map) container.set(childOf(), childOf());
		else if (container instanceof Set) container.add(childOf());
		else {
			(container as Record<string, unknown>)[propertyNames[random(propertyNames.length)]] =
				childOf();
		}
	}
	containersOnPath.pop();
	return container;
};

const identities = new Map<unknown, number>();
const identityOf = (value: unknown) => {
	if (!identities.has(value)) identities.set(value, identities.size);
	return identities.get(value);
};

//the library's rules: null and undefined alike, -0 is 0, a template by its strings, plain containers
//by content in iteration order, a back-reference by its distance, everything else by identity
const serialize = (value: unknown, containersOnPath: Array<object>): string => {
	if (value === null || value === undefined) return "nullish";
	switch (typeof value) {
		case "number":
			return Object.is(value, -0) ? "number 0" : `number ${value}`;
		case "string":
			return `string ${JSON.stringify(value)}`;
		case "boolean":
			return `boolean ${value}`;
		case "bigint":
			return `bigint ${value}`;
		case "function":
		case "symbol":
			return `reference ${identityOf(value)}`;
		case "object":
		case "undefined":
			break;
	}
	const object = value as object;
	const serializeChild = (child: unknown) => serialize(child, containersOnPath);
	if (isTemplate(object)) {
		return `template ${JSON.stringify([...object.__templateStrings])}(${object.values.map(serializeChild).join(",")})`;
	}
	const isWalked = [Array, Object, Map, Set].includes(object.constructor as never);
	if (!isWalked) return `reference ${identityOf(value)}`;
	const ancestorIndex = containersOnPath.lastIndexOf(object);
	if (ancestorIndex !== -1) return `ancestor ${containersOnPath.length - ancestorIndex}`;
	containersOnPath.push(object);
	let serialization: string;
	if (Array.isArray(object)) serialization = `[${object.map(serializeChild).join(",")}]`;
	else if (object instanceof Map) {
		serialization = `map(${[...object].map(([key, entry]) => `${serializeChild(key)}=>${serializeChild(entry)}`).join(",")})`;
	} else if (object instanceof Set) {
		serialization = `set(${[...object].map(serializeChild).join(",")})`;
	} else {
		serialization = `{${Object.entries(object)
			.map(([name, entry]) => `${JSON.stringify(name)}:${serializeChild(entry)}`)
			.join(",")}}`;
	}
	containersOnPath.pop();
	return serialization;
};

test("a value and its twin one change away hash alike exactly when they serialize alike", () => {
	const PAIR_COUNT = 100_000;
	const missedChanges: Array<string> = [];
	const falseChanges: Array<string> = [];
	for (let seed = 1; seed <= PAIR_COUNT; seed++) {
		const value = generate(createRandom(seed), 0, []);
		const twin = generate(createTwinRandom(seed, seed % 7), 0, []);
		const isSerializationEqual = serialize(value, []) === serialize(twin, []);
		const isHashEqual = hashValue(value) === hashValue(twin);
		if (isHashEqual && !isSerializationEqual) {
			missedChanges.push(`${serialize(value, [])} vs ${serialize(twin, [])}`);
		}
		if (!isHashEqual && isSerializationEqual) falseChanges.push(serialize(value, []));
	}
	expect(missedChanges.slice(0, 3)).toEqual([]);
	expect(falseChanges.slice(0, 3)).toEqual([]);
});

//small values repeat their shapes often, so every pair among them is compared, including pairs that
//differ in several places at once, which a twin never does
test("among many small values, equal hashes mean equal serializations", () => {
	const VALUE_COUNT = 200_000;
	const smallLeaves: Array<unknown> = [
		0,
		-0,
		1,
		4182,
		423877,
		"",
		"a",
		"ab",
		null,
		undefined,
		true,
		false,
		0n,
		Symbol.for("a"),
		unregisteredSymbol,
		firstFunction,
	];
	const generateSmall = (random: (below: number) => number, depth: number): unknown => {
		const kind = random(depth >= 3 ? 1 : 7);
		const childOf = () => generateSmall(random, depth + 1);
		if (kind === 0) return smallLeaves[random(smallLeaves.length)];
		if (kind <= 2) return Array.from({ length: random(3) }, childOf);
		if (kind === 3) {
			const object: Record<string, unknown> = {};
			const propertyCount = random(3);
			for (let index = 0; index < propertyCount; index++) {
				object[["a", "b", "ab"][random(3)]] = childOf();
			}
			return object;
		}
		if (kind === 4) return new Map([[childOf(), childOf()]]);
		if (kind === 5) return new Set([childOf(), childOf()]);
		return templates[random(templates.length)]([childOf(), childOf()]);
	};
	const serializationByHash = new Map<number, string>();
	const hashBySerialization = new Map<string, number>();
	const missedChanges: Array<string> = [];
	const falseChanges: Array<string> = [];
	const random = createRandom(7);
	for (let index = 0; index < VALUE_COUNT; index++) {
		const value = generateSmall(random, 0);
		const serialization = serialize(value, []);
		const hash = hashValue(value);
		const serializationWithThisHash = serializationByHash.get(hash);
		if (serializationWithThisHash === undefined) serializationByHash.set(hash, serialization);
		else if (serializationWithThisHash !== serialization) {
			missedChanges.push(`${serializationWithThisHash} vs ${serialization}`);
		}
		const hashOfThisSerialization = hashBySerialization.get(serialization);
		if (hashOfThisSerialization === undefined) hashBySerialization.set(serialization, hash);
		else if (hashOfThisSerialization !== hash) falseChanges.push(serialization);
	}
	expect(missedChanges.slice(0, 3)).toEqual([]);
	expect(falseChanges.slice(0, 3)).toEqual([]);
});
