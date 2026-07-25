import { describe, test, expect } from "vitest";
import { compileStyleSheet } from "../css";

describe("dynamic declarations", () => {
	test("single value hole addresses its rule and property", () => {
		const plan = compileStyleSheet([".box { color: ", 0, "; }"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0],
				propertyName: "color",
				priority: "",
				valueParts: [" ", 0],
			},
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("multiple holes in one declaration collapse to one entry", () => {
		const plan = compileStyleSheet([
			".box { transform: rotate(",
			0,
			"deg) translateX(",
			1,
			"px); }",
		]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0],
				propertyName: "transform",
				priority: "",
				valueParts: [" rotate(", 0, "deg) translateX(", 1, "px)"],
			},
		]);
	});

	test("two declarations in one rule share the rule path", () => {
		const plan = compileStyleSheet([".a{width:", 0, ";height:", 1, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
			{ rulePath: [0], propertyName: "height", priority: "", valueParts: [1] },
		]);
	});

	test("hole-free declarations produce no entries", () => {
		const plan = compileStyleSheet([".a{color: red; width:", 0, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("consecutive holes stay one declaration entry", () => {
		const plan = compileStyleSheet([".a{margin:", 0, "", 1, "px}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0],
				propertyName: "margin",
				priority: "",
				valueParts: [0, 1, "px"],
			},
		]);
	});

	test("rules are indexed in source order", () => {
		const plan = compileStyleSheet([".a{color:", 0, "}.b{color:", 1, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "color", priority: "", valueParts: [0] },
			{ rulePath: [1], propertyName: "color", priority: "", valueParts: [1] },
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [], expectedRuleCount: 2 },
		]);
	});

	test("a sheet without any hole compiles to nothing", () => {
		expect(compileStyleSheet(["div{color:red}"])).toBeNull();
	});
});

describe("property names", () => {
	test("an uppercase property name is lowercased for setProperty", () => {
		const plan = compileStyleSheet(["div{COLOR:", 0, "}"]);
		expect(plan?.dynamicDeclarations[0].propertyName).toBe("color");
	});

	test("a custom property keeps its case", () => {
		const plan = compileStyleSheet(["div{--myVar:", 0, "}"]);
		expect(plan?.dynamicDeclarations[0].propertyName).toBe("--myVar");
	});

	test("a vendor-prefixed property is addressable", () => {
		const plan = compileStyleSheet(["div{-webkit-line-clamp:", 0, "}"]);
		expect(plan?.dynamicDeclarations[0].propertyName).toBe(
			"-webkit-line-clamp",
		);
	});

	test("a comment before the property name is stripped", () => {
		const plan = compileStyleSheet(["div{/* hi */width:", 0, "}"]);
		expect(plan?.dynamicDeclarations[0].propertyName).toBe("width");
	});

	test("a malformed holed property name bails", () => {
		expect(compileStyleSheet(["div{wi dth:", 0, "}"])).toBeNull();
	});
});

describe("duplicate properties", () => {
	test("a static duplicate after a holed property bails", () => {
		expect(compileStyleSheet(["div{color:", 0, ";color:red}"])).toBeNull();
	});

	test("a holed duplicate after a static property bails", () => {
		expect(compileStyleSheet(["div{color:red;color:", 0, "}"])).toBeNull();
	});

	test("two holed declarations of one property bail", () => {
		expect(compileStyleSheet(["div{color:", 0, ";color:", 1, "}"])).toBeNull();
	});

	test("the same property in two different rules is fine", () => {
		const plan = compileStyleSheet([".a{color:", 0, "}.b{color:red}"]);
		expect(plan).not.toBeNull();
	});

	test("static duplicates without any hole are the browser's business", () => {
		const plan = compileStyleSheet(["div{color:red;color:blue;width:", 0, "}"]);
		expect(plan).not.toBeNull();
	});
});

describe("nesting", () => {
	test("a nested style rule gets a two-step path", () => {
		const plan = compileStyleSheet(["div{.b{color:", 0, "}}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0, 0],
				propertyName: "color",
				priority: "",
				valueParts: [0],
			},
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [0], expectedRuleCount: 1 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("declarations before a nested rule stay on the style rule itself", () => {
		const plan = compileStyleSheet(["div{width:", 0, ";.b{color:red}}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("declarations after a nested rule land in an implicit nested-declarations rule", () => {
		const plan = compileStyleSheet(["div{.b{color:red}width:", 0, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0, 1],
				propertyName: "width",
				priority: "",
				valueParts: [0],
			},
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [0], expectedRuleCount: 2 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("a nested selector with a pseudo-class bails", () => {
		expect(
			compileStyleSheet(["div{&:hover{color:red}width:", 0, "}"]),
		).toBeNull();
	});
});

describe("at-rules", () => {
	test("a hole in a rule nested in @media is addressed through the media rule", () => {
		const plan = compileStyleSheet([
			"@media (min-width: 600px){.a{color:",
			0,
			"}}",
		]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0, 0],
				propertyName: "color",
				priority: "",
				valueParts: [0],
			},
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [0], expectedRuleCount: 1 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("an at-rule nested inside a style rule holds an implicit nested-declarations rule", () => {
		const plan = compileStyleSheet([
			"div{@media (hover:hover){color:",
			0,
			"}}",
		]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0, 0, 0],
				propertyName: "color",
				priority: "",
				valueParts: [0],
			},
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [0, 0], expectedRuleCount: 1 },
			{ rulePath: [0], expectedRuleCount: 1 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("a hole in a keyframe declaration addresses the keyframe block", () => {
		const plan = compileStyleSheet([
			"@keyframes spin{to{transform:rotate(",
			0,
			"deg)}}",
		]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0, 0],
				propertyName: "transform",
				priority: "",
				valueParts: ["rotate(", 0, "deg)"],
			},
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [0], expectedRuleCount: 1 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("a prelude-less @scope scopes rules with distinct per-instance sheets", () => {
		const plan = compileStyleSheet(["@scope{.dot{background:", 0, "}}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0, 0],
				propertyName: "background",
				priority: "",
				valueParts: [0],
			},
		]);
	});

	test("a statement at-rule occupies a rule slot", () => {
		const plan = compileStyleSheet(["@import url(x.css);.a{color:", 0, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [1], propertyName: "color", priority: "", valueParts: [0] },
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [], expectedRuleCount: 2 },
		]);
	});

	test("a @layer statement occupies a rule slot", () => {
		const plan = compileStyleSheet(["@layer a, b;.x{color:", 0, "}"]);
		expect(plan?.dynamicDeclarations[0].rulePath).toEqual([1]);
	});

	test("a bare holed declaration directly inside top-level @media bails", () => {
		expect(compileStyleSheet(["@media screen{color:", 0, "}"])).toBeNull();
	});

	test("a hole inside @font-face bails — descriptors are not addressable", () => {
		expect(compileStyleSheet(["@font-face{src:", 0, "}"])).toBeNull();
	});

	test("a hole inside @property bails", () => {
		expect(
			compileStyleSheet(["@property --x{initial-value:", 0, "}"]),
		).toBeNull();
	});

	test("descriptor at-rule names are case-insensitive", () => {
		expect(compileStyleSheet(["@FONT-FACE{src:", 0, "}"])).toBeNull();
	});

	test("a hole after a closed descriptor block is fast again", () => {
		const plan = compileStyleSheet([
			"@font-face{src:url(x.woff2)}.a{color:",
			0,
			"}",
		]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [1], propertyName: "color", priority: "", valueParts: [0] },
		]);
		expect(plan?.ruleCountChecks).toEqual([
			{ rulePath: [], expectedRuleCount: 2 },
		]);
	});
});

describe("!important", () => {
	test("a static trailing !important becomes the priority argument", () => {
		const plan = compileStyleSheet(["div{color:", 0, " !important}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0],
				propertyName: "color",
				priority: "important",
				valueParts: [0, " "],
			},
		]);
	});

	test("a top-level bang that is not !important bails", () => {
		expect(compileStyleSheet(["div{color:", 0, " !imp}"])).toBeNull();
	});

	test("two top-level bangs bail", () => {
		expect(
			compileStyleSheet(["div{color:", 0, " !important !important}"]),
		).toBeNull();
	});

	test("a bang before a hole bails", () => {
		expect(compileStyleSheet(["div{color: x !", 0, "}"])).toBeNull();
	});

	test("a bang in a hole-free declaration is fine", () => {
		const plan = compileStyleSheet([
			"div{color: red !important; width:",
			0,
			"}",
		]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("a trailing comment after !important in a holed declaration bails", () => {
		expect(
			compileStyleSheet(["div{color:", 0, " !important /* note */}"]),
		).toBeNull();
	});
});

describe("structural bails", () => {
	test("a hole in a selector bails", () => {
		expect(compileStyleSheet(["div.", 0, "{color:red}"])).toBeNull();
	});

	test("a hole in a property name bails", () => {
		expect(compileStyleSheet(["div{", 0, ":red}"])).toBeNull();
	});

	test("a hole in an at-rule prelude bails", () => {
		expect(
			compileStyleSheet(["@media (min-width:", 0, "px){div{color:red}}"]),
		).toBeNull();
	});

	test("a whole-stylesheet hole bails", () => {
		expect(compileStyleSheet(["", 0, ""])).toBeNull();
	});

	test("an unclosed rule bails", () => {
		expect(compileStyleSheet(["div{color:", 0, ";"])).toBeNull();
	});

	test("a sheet ending inside a value bails", () => {
		expect(compileStyleSheet(["div{color:", 0, ""])).toBeNull();
	});

	test("a stray closing brace bails", () => {
		expect(compileStyleSheet(["div{color:red}}.a{width:", 0, "}"])).toBeNull();
	});
});

describe("strings and comments", () => {
	test("a hole inside a string bails", () => {
		expect(compileStyleSheet(['div{content:"', 0, '"}'])).toBeNull();
	});

	test("a semicolon inside a string is not a terminator", () => {
		const plan = compileStyleSheet(['div{content:"a;b";width:', 0, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("a hole inside a comment bails", () => {
		expect(compileStyleSheet(["div{/* ", 0, " */}"])).toBeNull();
	});

	test("braces inside a comment are inert", () => {
		const plan = compileStyleSheet(["div{/* } */width:", 0, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test('"/*/" does not close its own comment', () => {
		const plan = compileStyleSheet(["div{/*/ width:red*/height:", 0, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "height", priority: "", valueParts: [0] },
		]);
	});

	test("an unterminated string bails", () => {
		expect(compileStyleSheet(['div{content:"a}', 0, ""])).toBeNull();
	});

	test("an escaped backslash does not swallow the closing quote", () => {
		const plan = compileStyleSheet(['div{content:"a\\\\";width:', 0, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("a comment inside a holed value is kept in the value parts", () => {
		const plan = compileStyleSheet(["div{color:/* c */", 0, "}"]);
		expect(plan?.dynamicDeclarations).toEqual([
			{
				rulePath: [0],
				propertyName: "color",
				priority: "",
				valueParts: ["/* c */", 0],
			},
		]);
	});
});

describe("parentheses", () => {
	test("a semicolon inside url() is not a terminator", () => {
		const plan = compileStyleSheet([
			".a{background:url(img;x.png);width:",
			0,
			"}",
		]);
		expect(plan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("an unclosed parenthesis bails", () => {
		expect(compileStyleSheet([".a{width:calc(", 0, "}"])).toBeNull();
	});
});

describe("parser reuse", () => {
	test("two compilations do not share state", () => {
		const firstPlan = compileStyleSheet(["div{.b{color:red}width:", 0, "}"]);
		const secondPlan = compileStyleSheet(["p{color:", 0, "}"]);
		expect(firstPlan?.dynamicDeclarations[0].rulePath).toEqual([0, 1]);
		expect(secondPlan?.dynamicDeclarations).toEqual([
			{ rulePath: [0], propertyName: "color", priority: "", valueParts: [0] },
		]);
		expect(secondPlan?.ruleCountChecks).toEqual([
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});
});
