import { describe, test, expect } from "vitest";
import { analyzeStyle, composeSheet } from "../css";

const sheetOf = (plan: ReturnType<typeof analyzeStyle>) =>
	plan === null ? null : composeSheet(plan, plan.groupNames);

//46 in base36 is "1a", matching the plan doc's examples
const TEMPLATE_HASH = 46;

describe("value groups", () => {
	test("single value hole becomes one group and one var()", () => {
		const plan = analyzeStyle([".box { color: ", 0, "; }"], TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe(".box { color:var(--1a-0); }");
		expect(plan?.groupNames).toEqual(["--1a-0"]);
		expect(plan?.groups).toEqual([{ ordinal: 0, valueParts: [" ", 0] }]);
	});

	test("multiple holes in one declaration collapse to one group", () => {
		const plan = analyzeStyle(
			[".box { transform: rotate(", 0, "deg) translateX(", 1, "px); }"],
			TEMPLATE_HASH,
		);
		expect(sheetOf(plan)).toBe(".box { transform:var(--1a-0); }");
		expect(plan?.groups).toEqual([
			{ ordinal: 0, valueParts: [" rotate(", 0, "deg) translateX(", 1, "px)"] },
		]);
	});

	test("two declarations keep their terminators in the sheet", () => {
		const plan = analyzeStyle(
			[".a{width:", 0, ";height:", 1, "}"],
			TEMPLATE_HASH,
		);
		expect(sheetOf(plan)).toBe(".a{width:var(--1a-0);height:var(--1a-1)}");
		expect(plan?.groups).toEqual([
			{ ordinal: 0, valueParts: [0] },
			{ ordinal: 1, valueParts: [1] },
		]);
	});

	test("hole-free declarations stream into the sheet verbatim", () => {
		const plan = analyzeStyle([".a{color: red; width:", 0, "}"], TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe(".a{color: red; width:var(--1a-0)}");
		expect(plan?.groups).toEqual([{ ordinal: 0, valueParts: [0] }]);
	});

	test("consecutive holes share the group of the first expression", () => {
		const plan = analyzeStyle([".a{margin:", 0, "", 1, "px}"], TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe(".a{margin:var(--1a-0)}");
		expect(plan?.groups).toEqual([{ ordinal: 0, valueParts: [0, 1, "px"] }]);
	});
});

describe("naming", () => {
	test("a negative template hash yields no stray dash inside the name", () => {
		const plan = analyzeStyle(["a{b:", 0, "}"], -1);
		expect(plan?.groupNames[0]).toBe(`--${(4294967295).toString(36)}-0`);
	});

	test("the ordinal is the expression index, not a per-binding counter", () => {
		const plan = analyzeStyle([".a{color:", 2, "}"], TEMPLATE_HASH);
		expect(plan?.groupNames[0]).toBe("--1a-2");
	});

	test("two bindings of one template get disjoint names with no shared state", () => {
		const firstPlan = analyzeStyle([".a{color:", 0, "}"], TEMPLATE_HASH);
		const secondPlan = analyzeStyle([".b{width:", 1, "}"], TEMPLATE_HASH);
		expect(firstPlan?.groupNames[0]).toBe("--1a-0");
		expect(secondPlan?.groupNames[0]).toBe("--1a-1");
	});

	test("composeSheet with substitute names supports instance suffixing", () => {
		const plan = analyzeStyle(
			[".a{width:", 0, ";height:", 1, "}"],
			TEMPLATE_HASH,
		);
		expect(composeSheet(plan!, ["--1a-2-0", "--1a-2-1"])).toBe(
			".a{width:var(--1a-2-0);height:var(--1a-2-1)}",
		);
	});
});

describe("!important", () => {
	test("a static trailing !important is hoisted into the sheet", () => {
		const plan = analyzeStyle(["div{color:", 0, " !important}"], TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe("div{color:var(--1a-0) !important}");
		expect(plan?.groups).toEqual([{ ordinal: 0, valueParts: [0, " "] }]);
	});

	test("a top-level bang that is not !important bails", () => {
		expect(analyzeStyle(["div{color:", 0, " !imp}"], TEMPLATE_HASH)).toBeNull();
	});

	test("two top-level bangs bail", () => {
		const parts = ["div{color:", 0, " !important !important}"];
		expect(analyzeStyle(parts, TEMPLATE_HASH)).toBeNull();
	});

	test("a bang before a hole bails", () => {
		expect(analyzeStyle(["div{color: x !", 0, "}"], TEMPLATE_HASH)).toBeNull();
	});

	test("a bang in a hole-free declaration streams verbatim", () => {
		const plan = analyzeStyle(
			["div{color: red !important; width:", 0, "}"],
			TEMPLATE_HASH,
		);
		expect(sheetOf(plan)).toBe("div{color: red !important; width:var(--1a-0)}");
	});
});

describe("structural bails", () => {
	test("a hole in a selector bails", () => {
		expect(analyzeStyle(["div.", 0, "{color:red}"], TEMPLATE_HASH)).toBeNull();
	});

	test("a hole in a property name bails", () => {
		expect(analyzeStyle(["div{", 0, ":red}"], TEMPLATE_HASH)).toBeNull();
	});

	test("a hole in an at-rule prelude bails", () => {
		const parts = ["@media (min-width:", 0, "px){div{color:red}}"];
		expect(analyzeStyle(parts, TEMPLATE_HASH)).toBeNull();
	});

	test("a whole-stylesheet hole bails", () => {
		expect(analyzeStyle(["", 0, ""], TEMPLATE_HASH)).toBeNull();
	});

	test("a nested selector with a pseudo-class bails", () => {
		const parts = ["div{&:hover{color:red}width:", 0, "}"];
		expect(analyzeStyle(parts, TEMPLATE_HASH)).toBeNull();
	});

	test("an unclosed rule bails", () => {
		expect(analyzeStyle(["div{color:", 0, ";"], TEMPLATE_HASH)).toBeNull();
	});

	test("a sheet ending inside a value bails", () => {
		expect(analyzeStyle(["div{color:", 0, ""], TEMPLATE_HASH)).toBeNull();
	});

	test("a stray closing brace bails", () => {
		const parts = ["div{color:red}}.a{width:", 0, "}"];
		expect(analyzeStyle(parts, TEMPLATE_HASH)).toBeNull();
	});
});

describe("descriptor at-rules", () => {
	test("a hole inside @font-face bails — var() does not substitute there", () => {
		expect(analyzeStyle(["@font-face{src:", 0, "}"], TEMPLATE_HASH)).toBeNull();
	});

	test("a hole inside @property bails", () => {
		const parts = ["@property --x{initial-value:", 0, "}"];
		expect(analyzeStyle(parts, TEMPLATE_HASH)).toBeNull();
	});

	test("descriptor at-rule names are case-insensitive", () => {
		expect(analyzeStyle(["@FONT-FACE{src:", 0, "}"], TEMPLATE_HASH)).toBeNull();
	});

	test("a hole after a closed descriptor block is fast again", () => {
		const parts = ["@font-face{src:url(x.woff2)}.a{color:", 0, "}"];
		const plan = analyzeStyle(parts, TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe(
			"@font-face{src:url(x.woff2)}.a{color:var(--1a-0)}",
		);
	});

	test("a statement at-rule does not poison the following rule", () => {
		const parts = ["@import url(x.css);.a{color:", 0, "}"];
		const plan = analyzeStyle(parts, TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe("@import url(x.css);.a{color:var(--1a-0)}");
	});

	test("a hole in a rule nested in @media is fast", () => {
		const parts = ["@media (min-width: 600px){.a{color:", 0, "}}"];
		const plan = analyzeStyle(parts, TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe(
			"@media (min-width: 600px){.a{color:var(--1a-0)}}",
		);
	});

	test("a hole in a keyframe declaration is fast", () => {
		const parts = ["@keyframes spin{to{transform:rotate(", 0, "deg)}}"];
		const plan = analyzeStyle(parts, TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe("@keyframes spin{to{transform:var(--1a-0)}}");
		expect(plan?.groups).toEqual([
			{ ordinal: 0, valueParts: ["rotate(", 0, "deg)"] },
		]);
	});

	test("a hole in an at-rule nested inside a style rule is fast", () => {
		const parts = ["div{@media (hover:hover){color:", 0, "}}"];
		const plan = analyzeStyle(parts, TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe("div{@media (hover:hover){color:var(--1a-0)}}");
	});
});

describe("strings and comments", () => {
	test("a hole inside a string bails", () => {
		expect(analyzeStyle(['div{content:"', 0, '"}'], TEMPLATE_HASH)).toBeNull();
	});

	test("a semicolon inside a string is not a terminator", () => {
		const parts = ['div{content:"a;b";width:', 0, "}"];
		const plan = analyzeStyle(parts, TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe('div{content:"a;b";width:var(--1a-0)}');
	});

	test("a hole inside a comment bails", () => {
		expect(analyzeStyle(["div{/* ", 0, " */}"], TEMPLATE_HASH)).toBeNull();
	});

	test("braces inside a comment are inert", () => {
		const parts = ["div{/* } */width:", 0, "}"];
		const plan = analyzeStyle(parts, TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe("div{/* } */width:var(--1a-0)}");
	});

	test('"/*/" does not close its own comment', () => {
		const parts = ["div{/*/ width:red*/height:", 0, "}"];
		const plan = analyzeStyle(parts, TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe("div{/*/ width:red*/height:var(--1a-0)}");
	});

	test("an unterminated string bails", () => {
		expect(analyzeStyle(['div{content:"a}', 0, ""], TEMPLATE_HASH)).toBeNull();
	});
});

describe("parentheses", () => {
	test("a semicolon inside url() is not a terminator", () => {
		const parts = [".a{background:url(img;x.png);width:", 0, "}"];
		const plan = analyzeStyle(parts, TEMPLATE_HASH);
		expect(sheetOf(plan)).toBe(
			".a{background:url(img;x.png);width:var(--1a-0)}",
		);
	});

	test("an unclosed parenthesis bails", () => {
		expect(analyzeStyle([".a{width:calc(", 0, "}"], TEMPLATE_HASH)).toBeNull();
	});
});
