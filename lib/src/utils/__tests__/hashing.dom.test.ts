import { describe, expect, test } from "vitest";
import { hashValue } from "../../rendering/value-hashing";
import { stringHash } from "../hashing";

describe("stringHash", () => {
	test("empty string hashes to 0", () => {
		expect(stringHash("")).toBe(0);
	});

	test("is deterministic for the same input", () => {
		expect(stringHash("hello")).toBe(stringHash("hello"));
	});

	test("returns a 32-bit signed integer", () => {
		const result = stringHash("a".repeat(500));
		expect(Number.isInteger(result)).toBe(true);
		expect(result).toBe(result | 0);
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

	test("a cycle truncates instead of overflowing the stack", () => {
		const cyclic: Record<string, unknown> = { name: "root" };
		cyclic.self = cyclic;

		expect(() => hashValue(cyclic)).not.toThrow();
		expect(hashValue(cyclic)).toBe(hashValue(cyclic));
	});

	test("two cycles that differ above the limit still hash apart", () => {
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

describe("hashValue - seeded random inputs", () => {
	//sequential values never collide, so they cannot tell a sound hash from one that lets
	//inputs trade places; 5,000 inputs in 32 bits expect 0.003 collisions
	const INPUT_COUNT = 5_000;

	const createRandom = (seed: number) => {
		let randomState = seed;
		return (below: number) => {
			randomState = (Math.imul(randomState, 1103515245) + 12345) >>> 0;
			return (randomState >>> 8) % below;
		};
	};

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
