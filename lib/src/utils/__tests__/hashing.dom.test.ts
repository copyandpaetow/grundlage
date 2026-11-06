import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { hashValue } from "../../rendering/value-hashing";
import * as TAG from "../../rendering/value-hashing-tag";
import { html } from "../../template";
import { stringHash } from "../hashing";

const createRandom = (seed: number) => {
	let randomState = seed;
	return (below: number) => {
		randomState = (Math.imul(randomState, 1103515245) + 12345) >>> 0;
		return (randomState >>> 8) % below;
	};
};

const collectGarbageInANewJob = async (): Promise<void> => {
	setFlagsFromString("--expose-gc");
	//a WeakRef keeps its target until the current job ends
	await new Promise((resolve) => setTimeout(resolve));
	const collectGarbage: () => void = runInNewContext("gc");
	collectGarbage();
};

describe("stringHash", () => {
	//two code units go into each step, so without the length a trailing NUL would vanish
	test("a trailing NUL hashes apart from the string without it", () => {
		expect(stringHash("a\0")).not.toBe(stringHash("a"));
	});

	//the second code unit of a pair fills the high half of its word, where a multiply alone never
	//carries a difference down
	test("strings that differ only in the high half of their words hash apart", () => {
		expect(stringHash("aAaAa䁁")).not.toBe(stringHash("aAa䁁aA"));
	});

	test("is deterministic for the same input", () => {
		expect(stringHash("hello")).toBe(stringHash("hello"));
	});

	test("returns a whole number below 2^53", () => {
		const result = stringHash("a".repeat(500));
		expect(Number.isSafeInteger(result)).toBe(true);
		expect(result).toBeGreaterThanOrEqual(0);
	});

	test("different inputs usually produce different hashes", () => {
		expect(stringHash("foo")).not.toBe(stringHash("bar"));
		expect(stringHash("abc")).not.toBe(stringHash("abd"));
	});
});

describe("hashValue - primitives", () => {
	test("null and undefined share the nullish hash", () => {
		expect(hashValue(null)).toBe(hashValue(undefined));
	});

	test("true and false hash distinctly and stay out of the integers' value space", () => {
		expect(hashValue(true)).not.toBe(hashValue(false));
		//the type tag keeps booleans from colliding with 1 and 0
		expect(hashValue(true)).not.toBe(hashValue(1));
		expect(hashValue(false)).not.toBe(hashValue(0));
	});

	test("integers hash deterministically and distinctly", () => {
		expect(hashValue(42)).toBe(hashValue(42));
		expect(hashValue(42)).not.toBe(hashValue(43));
		expect(hashValue(0)).not.toBe(hashValue(-7));
	});

	test("float hashing is deterministic", () => {
		expect(hashValue(3.14)).toBe(hashValue(3.14));
		expect(hashValue(50.12345)).toBe(hashValue(50.12345));
	});

	test("tightly-clustered floats produce distinct hashes", () => {
		//the float hash has to separate neighbouring values an animation actually produces, widths like
		//50.1, 50.100001, 50.2
		const values = [50.1, 50.1000001, 50.10001, 50.2, 50.20000001];
		const hashes = new Set(values.map(hashValue));
		expect(hashes.size).toBe(values.length);
	});

	test("NaN hash is deterministic across calls", () => {
		expect(hashValue(NaN)).toBe(hashValue(NaN));
	});

	test("Infinity and -Infinity have distinct hashes", () => {
		expect(hashValue(Infinity)).not.toBe(hashValue(-Infinity));
	});

	test("strings hash deterministically and distinctly", () => {
		expect(hashValue("hello")).toBe(hashValue("hello"));
		expect(hashValue("hello")).not.toBe(hashValue("world"));
	});

	test("empty string is deterministic and distinct from nullish", () => {
		expect(hashValue("")).toBe(hashValue(""));
		expect(hashValue("")).not.toBe(hashValue(null));
	});

	test("bigints hash deterministically and distinctly", () => {
		expect(hashValue(42n)).toBe(hashValue(42n));
		expect(hashValue(42n)).not.toBe(hashValue(43n));
		expect(hashValue(0n)).not.toBe(hashValue(null));
	});

	test("bigints beyond the 32-bit range stay distinct", () => {
		expect(hashValue(2n ** 64n)).not.toBe(hashValue(2n ** 64n + 1n));
	});

	//a bigint reaching the reference registry would throw on a WeakMap primitive key
	test("a nested bigint hashes instead of throwing", () => {
		expect(() => hashValue([1n, { total: 2n }])).not.toThrow();
		expect(hashValue([1n])).toBe(hashValue([1n]));
		expect(hashValue([1n])).not.toBe(hashValue([2n]));
	});
});

describe("hashValue - arrays", () => {
	test("same content produces same hash", () => {
		expect(hashValue([1, 2, 3])).toBe(hashValue([1, 2, 3]));
	});

	test("different content produces different hash", () => {
		expect(hashValue([1, 2, 3])).not.toBe(hashValue([1, 2, 4]));
	});

	test("order matters", () => {
		expect(hashValue([1, 2, 3])).not.toBe(hashValue([3, 2, 1]));
	});

	test("empty array", () => {
		expect(hashValue([])).toBe(hashValue([]));
	});

	test("nested arrays hash by content", () => {
		expect(hashValue([[1, 2], [3]])).toBe(hashValue([[1, 2], [3]]));
	});
});

describe("hashValue - plain objects", () => {
	test("same content produces same hash", () => {
		expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ a: 1, b: 2 }));
	});

	test("different values produce different hashes", () => {
		expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
	});

	test("different keys produce different hashes", () => {
		expect(hashValue({ a: 1 })).not.toBe(hashValue({ b: 1 }));
	});
});

describe("hashValue - reference types", () => {
	test("same function reference returns same hash", () => {
		const fn = () => {};
		expect(hashValue(fn)).toBe(hashValue(fn));
	});

	test("different function references return different hashes", () => {
		expect(hashValue(() => {})).not.toBe(hashValue(() => {}));
	});

	test("class instance uses reference identity", () => {
		class Foo {}
		const instance = new Foo();
		expect(hashValue(instance)).toBe(hashValue(instance));
	});

	test("two fresh class instances get distinct counter ids", () => {
		//the WeakMap fallback hands out monotonically increasing ids, so two distinct objects never
		//collide. It stays separate from the function case because there lambda identity already
		//differs, and a regression hitting only one branch would hide there
		class Foo {}
		const firstInstance = new Foo();
		const secondInstance = new Foo();
		expect(hashValue(firstInstance)).not.toBe(hashValue(secondInstance));
	});

	test("a Symbol.for symbol hashes by identity instead of throwing", () => {
		const order = Symbol.for("order");
		expect(hashValue({ kind: order })).toBe(
			hashValue({ kind: Symbol.for("order") }),
		);
		expect(hashValue({ kind: order })).not.toBe(
			hashValue({ kind: Symbol.for("invoice") }),
		);
	});

	test("two symbols with the same description hash apart", () => {
		expect(hashValue(Symbol("order"))).not.toBe(hashValue(Symbol("order")));
	});

	test("same Map instance hashes equal across reads", () => {
		const map = new Map<string, number>([["a", 1]]);
		expect(hashValue(map)).toBe(hashValue(map));
	});

	test("two fresh Maps with identical contents hash equal", () => {
		//maps are walked for content now, so equal entries hash equal across references
		const first = new Map<string, number>([["a", 1]]);
		const second = new Map<string, number>([["a", 1]]);
		expect(hashValue(first)).toBe(hashValue(second));
		expect(hashValue(first)).not.toBe(hashValue(new Map([["a", 2]])));
	});

	test("same Set instance hashes equal across reads", () => {
		const set = new Set(["a"]);
		expect(hashValue(set)).toBe(hashValue(set));
	});

	test("two fresh Sets with identical contents hash equal", () => {
		const first = new Set(["a"]);
		const second = new Set(["a"]);
		expect(hashValue(first)).toBe(hashValue(second));
		expect(hashValue(first)).not.toBe(hashValue(new Set(["b"])));
	});
});

describe("hashValue - prototype-less objects", () => {
	//`Object.create(null)` has no `.constructor`, so the plain-object guard reads `undefined ===
	//Object` and is false: these fall through to the reference branch. Pinned so a later switch to a
	//tag check is a deliberate decision about prototype-less objects
	test("hashes the same reference equally across calls", () => {
		const plain = Object.create(null) as Record<string, unknown>;
		plain.value = 1;
		expect(hashValue(plain)).toBe(hashValue(plain));
	});

	test("two structurally identical prototype-less objects get distinct hashes", () => {
		const first = Object.create(null) as Record<string, unknown>;
		first.value = 1;
		const second = Object.create(null) as Record<string, unknown>;
		second.value = 1;
		expect(hashValue(first)).not.toBe(hashValue(second));
	});
});

describe("hashValue - digits that could trade places", () => {
	//a multiplier at or below the character range lets one character absorb another's carry;
	//these six were live collisions under `h * 31 + c`
	test("two-character strings that collide under a small multiplier stay apart", () => {
		expect(hashValue("Aa")).not.toBe(hashValue("BB"));
		expect(hashValue("aaa")).not.toBe(hashValue("abB"));
	});

	test("the same trade inside a container stays apart", () => {
		expect(hashValue([0, 31])).not.toBe(hashValue([1, 0]));
		expect(hashValue({ name: "Aa" })).not.toBe(hashValue({ name: "BB" }));
		expect(hashValue(new Set(["Aa"]))).not.toBe(hashValue(new Set(["BB"])));
	});

	test("every three-character string over the common alphabet hashes uniquely", () => {
		const alphabet =
			"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -";
		const seen = new Set<number>();
		for (const first of alphabet)
			for (const second of alphabet)
				for (const third of alphabet)
					seen.add(stringHash(first + second + third));
		expect(seen.size).toBe(alphabet.length ** 3);
	});
});

describe("hashValue - depth", () => {
	const nest = (levels: number, leaf: unknown): unknown => {
		let value: unknown = leaf;
		for (let index = 0; index < levels; index++) value = { inner: value };
		return value;
	};

	test("a cycle ends at its back-reference instead of overflowing the stack", () => {
		const cyclic: Record<string, unknown> = { name: "root" };
		cyclic.self = cyclic;

		expect(() => hashValue(cyclic)).not.toThrow();
		expect(hashValue(cyclic)).toBe(hashValue(cyclic));
	});

	test("two cycles that differ in content hash apart", () => {
		const first: Record<string, unknown> = { name: "a" };
		first.self = first;
		const second: Record<string, unknown> = { name: "b" };
		second.self = second;

		expect(hashValue(first)).not.toBe(hashValue(second));
	});

	test("a change at the documented depth of 64 is still seen", () => {
		expect(hashValue(nest(64, "a"))).not.toBe(hashValue(nest(64, "b")));
	});

	test("a change past it reads as unchanged, which is what the limit costs", () => {
		expect(hashValue(nest(65, "a"))).toBe(hashValue(nest(65, "b")));
	});
});

describe("hashValue - shared and cyclic data", () => {
	const userWithPosts = (titles: Array<string>) => {
		const user = {
			name: "ada",
			posts: [] as Array<{ title: string; author: unknown }>,
		};
		for (const title of titles) user.posts.push({ title, author: user });
		return user;
	};

	//walked again at every back-reference, three posts take about 3^21 steps
	test("posts pointing back at their user hash in a few steps", () => {
		expect(() => hashValue(userWithPosts(["a", "b", "c"]))).not.toThrow();
	});

	test("equal cyclic data hashes alike, whatever its identity", () => {
		expect(hashValue(userWithPosts(["a", "b", "c"]))).toBe(
			hashValue(userWithPosts(["a", "b", "c"])),
		);
	});

	test("a change behind a back-reference is still seen", () => {
		expect(hashValue(userWithPosts(["a", "b", "c"]))).not.toBe(
			hashValue(userWithPosts(["a", "x", "c"])),
		);
	});

	//under `F(accumulator) ^ value`, the same shape nested in itself added its part twice and cancelled
	test("a shape nested in itself still depends on what it holds", () => {
		const chain = (name: string) => ({ name, next: { name, next: null } });
		expect(hashValue(chain("a"))).not.toBe(hashValue(chain("b")));
	});

	test("a template wrapped in itself hashes apart from the bare value", () => {
		const paragraph = (content: unknown) => html`<p>${content}</p>`;
		expect(hashValue(paragraph(paragraph("a")))).not.toBe(hashValue("a"));
	});

	test("a value that reaches the same objects too often throws and names the fix", () => {
		let shared: Record<string, unknown> = { leaf: true };
		for (let level = 0; level < 22; level++)
			shared = { left: shared, right: shared };
		expect(() => hashValue(shared)).toThrow(/class instance/);
	});

	test("a finished walk keeps none of the value", async () => {
		let value: object | null = { rows: [{ label: "a" }] };
		const valueReference = new WeakRef(value);
		hashValue(value);
		value = null;
		await collectGarbageInANewJob();
		expect(valueReference.deref()).toBeUndefined();
	});

	test("a walk ended by a throw keeps none of the value", async () => {
		let value: object | null = {
			rows: [
				{
					get label() {
						throw new Error("a getter that throws");
					},
				},
			],
		};
		const valueReference = new WeakRef(value);
		expect(() => hashValue(value)).toThrow("a getter that throws");
		value = null;
		await collectGarbageInANewJob();
		expect(valueReference.deref()).toBeUndefined();
	});
});

//the walk reads a value as a sequence of words; each case below would read the same without the
//tag, count or end word that tells the two apart
describe("hashValue - where one value ends and the next begins", () => {
	test("an integer never reads as the word that starts another kind of value", () => {
		expect(hashValue((TAG.BOOLEAN << 24) | 1)).not.toBe(hashValue(true));
		expect(hashValue(TAG.NULLISH << 24)).not.toBe(hashValue(null));
	});

	test("integers on both sides of the one-word range hash apart", () => {
		const limit = 2 ** 23;
		const integers = [-limit - 1, -limit, limit - 1, limit, limit + 1];
		const hashes = new Set(integers.map(hashValue));
		expect(hashes.size).toBe(integers.length);
	});

	test("an array's length tells nesting apart", () => {
		expect(hashValue([[1], 2])).not.toBe(hashValue([[1, 2]]));
	});

	test("an object's end tells nesting apart", () => {
		expect(hashValue({ outer: { inner: 1 } })).not.toBe(
			hashValue({ outer: {}, inner: 1 }),
		);
	});

	test("a string's length tells a trailing NUL apart", () => {
		expect(hashValue("a\0")).not.toBe(hashValue("a"));
	});
});

describe("hashValue - changes that cancel out", () => {
	//the words of {}, null and false differ only in their top byte, and a multiply carries a difference
	//only upward: without a fold back down, this rotation read as unchanged
	test("values that differ only in their tag words hash apart", () => {
		expect(hashValue({ g: [{}, null, false] })).not.toBe(
			hashValue({ g: [null, false, {}] }),
		);
	});

	//a weighted sum, C + a·M + b with 4181·M = 2584·2^32 + 423877, read every move from (a, b) to
	//(a − 4181, b + 423877) as unchanged
	test("the pair that left a row stale hashes apart", () => {
		const row = (first: number, second: number) =>
			html`<li>${first}: ${second}</li>`;
		expect(hashValue(row(4182, 0))).not.toBe(hashValue(row(1, 423877)));
	});

	test("the same trade hashes apart from any starting values", () => {
		const random = createRandom(11);
		let collisions = 0;
		for (let draw = 0; draw < 1_000; draw++) {
			const first = 4181 + random(1_000_000);
			const second = random(1_000_000);
			if (
				hashValue([first, second]) ===
				hashValue([first - 4181, second + 423877])
			)
				collisions++;
		}
		expect(collisions).toBe(0);
	});

	//a list matches each new row against every old one: 10,000 rows replacing 10,000 others falsely
	//match in 2% of replaces under 32 bits, which also expect 4.7 collisions among these values
	test("200,000 distinct pairs of numbers hash without a collision", () => {
		const random = createRandom(13);
		const pairByHash = new Map<number, string>();
		let collisions = 0;
		for (let draw = 0; draw < 200_000; draw++) {
			const pair = [random(2 ** 30), random(2 ** 30)];
			const spelling = pair.join();
			const hash = hashValue(pair);
			const earlier = pairByHash.get(hash);
			if (earlier === undefined) pairByHash.set(hash, spelling);
			else if (earlier !== spelling) collisions++;
		}
		expect(collisions).toBe(0);
	});

	test("200,000 distinct random strings hash without a collision", () => {
		const random = createRandom(17);
		const textByHash = new Map<number, string>();
		let collisions = 0;
		for (let draw = 0; draw < 200_000; draw++) {
			let text = "";
			const length = 6 + random(7);
			for (let index = 0; index < length; index++)
				text += String.fromCharCode(65 + random(58));
			const hash = hashValue(text);
			const earlier = textByHash.get(hash);
			if (earlier === undefined) textByHash.set(hash, text);
			else if (earlier !== text) collisions++;
		}
		expect(collisions).toBe(0);
	});
});

describe("hashValue - seeded random inputs", () => {
	//sequential values never collide, so they cannot tell a sound hash from one that lets
	//inputs trade places; 5,000 inputs in 53 bits expect no collision
	const INPUT_COUNT = 5_000;

	const randomText = (random: (below: number) => number) => {
		let text = "";
		const length = random(12);
		for (let index = 0; index < length; index++)
			text += String.fromCharCode(65 + random(58));
		return text;
	};

	const shapes: Array<
		[string, (random: (below: number) => number) => unknown]
	> = [
		["strings", randomText],
		[
			"small integers in short arrays",
			(random) => Array.from({ length: 1 + random(4) }, () => random(64)),
		],
		[
			"plain objects",
			(random) => ({ [randomText(random)]: random(64), size: random(64) }),
		],
	];

	test.each(shapes)("%s: distinct inputs hash apart", (_shape, createInput) => {
		const random = createRandom(7);
		const inputByHash = new Map<number, string>();
		const distinctInputs = new Set<string>();
		let collisions = 0;
		for (let draw = 0; draw < INPUT_COUNT; draw++) {
			const input = createInput(random);
			const spelling = JSON.stringify(input);
			distinctInputs.add(spelling);
			const hash = hashValue(input);
			const earlier = inputByHash.get(hash);
			if (earlier === undefined) inputByHash.set(hash, spelling);
			else if (earlier !== spelling) collisions++;
		}
		expect(distinctInputs.size).toBeGreaterThan(INPUT_COUNT / 2);
		expect(collisions).toBe(0);
	});
});
