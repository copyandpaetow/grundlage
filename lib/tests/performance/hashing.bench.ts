import { describe } from "vitest";
import { stringHash, hashValue } from "../../src/utils/hashing";
import { bench } from "./bench-options";

describe("stringHash", () => {
	bench("short string (10 chars)", () => {
		stringHash("helloworld");
	});

	bench("medium string (100 chars)", () => {
		stringHash("a".repeat(100));
	});

	bench("long string (1000 chars)", () => {
		stringHash("a".repeat(1000));
	});

	bench("typical class attribute", () => {
		stringHash("flex items-center justify-between px-4 py-2");
	});
});

describe("hashValue", () => {
	bench("string", () => {
		hashValue("hello world");
	});

	bench("number", () => {
		hashValue(42);
	});

	bench("boolean", () => {
		hashValue(true);
	});

	bench("null", () => {
		hashValue(null);
	});

	bench("small array (5 strings)", () => {
		hashValue(["a", "b", "c", "d", "e"]);
	});

	bench("array of 50 numbers", () => {
		hashValue(Array.from({ length: 50 }, (_, i) => i));
	});

	bench("plain object (5 keys)", () => {
		hashValue({ a: 1, b: "two", c: true, d: null, e: 42 });
	});

	const stableRef = { complex: true };
	bench("stable object reference (WeakMap hit)", () => {
		hashValue(stableRef);
	});

	bench("function (new reference each time)", () => {
		hashValue(() => {});
	});
});
