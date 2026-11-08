import { describe, test, expect } from "vitest";
import { STYLE_SHEET_NOT_COMPILED } from "../constants";
import { compileStyleSheet } from "../css";
import { NO_REINSERTION } from "../constants";
import { CompiledStyleSheet, Part } from "../types";

const compiledOrThrow = (parts: Array<Part>): CompiledStyleSheet => {
	const compiled = compileStyleSheet(parts);
	if (compiled === STYLE_SHEET_NOT_COMPILED) throw new Error("expected the sheet to compile");
	return compiled;
};

//one entry per declaration, with the path of the block that holds it
const compileOrThrow = (parts: Array<Part>) => {
	const compiled = compiledOrThrow(parts);
	return {
		declarations: compiled.holedRules.flatMap((holedRule) =>
			holedRule.declarations.map((declaration) => ({
				rulePath: holedRule.rulePath,
				...declaration,
			})),
		),
		ruleCountChecks: compiled.ruleCountChecks,
	};
};

describe("holed declarations", () => {
	test("single value hole addresses its rule and property", () => {
		const plan = compileOrThrow([".box { color: ", 0, "; }"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0],
				propertyName: "color",
				priority: "",
				valueParts: [0],
			},
		]);
		expect(plan.ruleCountChecks).toEqual([{ rulePath: [], expectedRuleCount: 1 }]);
	});

	test("multiple holes in one declaration collapse to one entry", () => {
		const plan = compileOrThrow([".box { transform: rotate(", 0, "deg) translateX(", 1, "px); }"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0],
				propertyName: "transform",
				priority: "",
				valueParts: ["rotate(", 0, "deg) translateX(", 1, "px)"],
			},
		]);
	});

	test("two declarations in one rule share the rule path", () => {
		const plan = compileOrThrow([".a{width:", 0, ";height:", 1, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
			{ rulePath: [0], propertyName: "height", priority: "", valueParts: [1] },
		]);
	});

	test("hole-free declarations produce no entries", () => {
		const plan = compileOrThrow([".a{color: red; width:", 0, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("consecutive holes stay one declaration entry", () => {
		const plan = compileOrThrow([".a{margin:", 0, "", 1, "px}"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0],
				propertyName: "margin",
				priority: "",
				valueParts: [0, 1, "px"],
			},
		]);
	});

	test("rules are indexed in source order", () => {
		const plan = compileOrThrow([".a{color:", 0, "}.b{color:", 1, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "color", priority: "", valueParts: [0] },
			{ rulePath: [1], propertyName: "color", priority: "", valueParts: [1] },
		]);
		expect(plan.ruleCountChecks).toEqual([{ rulePath: [], expectedRuleCount: 2 }]);
	});

	test("a sheet without any hole compiles to nothing", () => {
		expect(compileStyleSheet(["div{color:red}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});
});

describe("property names", () => {
	test("an uppercase property name is lowercased for setProperty", () => {
		const plan = compileOrThrow(["div{COLOR:", 0, "}"]);
		expect(plan.declarations[0].propertyName).toBe("color");
	});

	test("a custom property keeps its case", () => {
		const plan = compileOrThrow(["div{--myVar:", 0, "}"]);
		expect(plan.declarations[0].propertyName).toBe("--myVar");
	});

	test("a vendor-prefixed property is addressable", () => {
		const plan = compileOrThrow(["div{-webkit-line-clamp:", 0, "}"]);
		expect(plan.declarations[0].propertyName).toBe("-webkit-line-clamp");
	});

	test("a comment before the property name is stripped", () => {
		const plan = compileOrThrow(["div{/* hi */width:", 0, "}"]);
		expect(plan.declarations[0].propertyName).toBe("width");
	});

	test("a malformed holed property name bails", () => {
		expect(compileStyleSheet(["div{wi dth:", 0, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});
});

describe("duplicate properties", () => {
	test("a static duplicate after a holed property bails", () => {
		expect(compileStyleSheet(["div{color:", 0, ";color:red}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a holed duplicate after a static property bails", () => {
		expect(compileStyleSheet(["div{color:red;color:", 0, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("two holed declarations of one property bail", () => {
		expect(compileStyleSheet(["div{color:", 0, ";color:", 1, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("the same property in two different rules is fine", () => {
		const plan = compileOrThrow([".a{color:", 0, "}.b{color:red}"]);
		expect(plan).not.toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("an escaped static name that spells a holed property bails", () => {
		expect(compileStyleSheet(["div{color:", 0, ";c\\olor:red}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("static duplicates without any hole are the browser's business", () => {
		const plan = compileOrThrow(["div{color:red;color:blue;width:", 0, "}"]);
		expect(plan).not.toBe(STYLE_SHEET_NOT_COMPILED);
	});
});

describe("nesting", () => {
	test("a nested style rule gets a two-step path", () => {
		const plan = compileOrThrow(["div{.b{color:", 0, "}}"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0, 0],
				propertyName: "color",
				priority: "",
				valueParts: [0],
			},
		]);
		expect(plan.ruleCountChecks).toEqual([
			{ rulePath: [0], expectedRuleCount: 1 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("declarations before a nested rule stay on the style rule itself", () => {
		const plan = compileOrThrow(["div{width:", 0, ";.b{color:red}}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
		expect(plan.ruleCountChecks).toEqual([{ rulePath: [], expectedRuleCount: 1 }]);
	});

	test("declarations after a nested rule land in an implicit nested-declarations rule", () => {
		const plan = compileOrThrow(["div{.b{color:red}width:", 0, "}"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0, 1],
				propertyName: "width",
				priority: "",
				valueParts: [0],
			},
		]);
		expect(plan.ruleCountChecks).toEqual([
			{ rulePath: [0], expectedRuleCount: 2 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("a nested selector with a pseudo-class is a rule, as the browser reads it", () => {
		const plan = compileOrThrow(["div{&:hover{color:red}width:", 0, "}"]);
		expect(plan.declarations[0].rulePath).toEqual([0, 1]);
	});

	test("a nested selector starting with a letter is a rule too", () => {
		const plan = compileOrThrow(["div{a:hover{color:", 0, "}}"]);
		expect(plan.declarations[0].rulePath).toEqual([0, 0]);
	});

	test("a custom property whose value opens a block bails", () => {
		expect(compileStyleSheet(["div{--x:{a:b};width:", 0, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});
});

describe("at-rules", () => {
	test("a hole in a rule nested in @media is addressed through the media rule", () => {
		const plan = compileOrThrow(["@media (min-width: 600px){.a{color:", 0, "}}"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0, 0],
				propertyName: "color",
				priority: "",
				valueParts: [0],
			},
		]);
		expect(plan.ruleCountChecks).toEqual([
			{ rulePath: [0], expectedRuleCount: 1 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("an at-rule nested inside a style rule holds an implicit nested-declarations rule", () => {
		const plan = compileOrThrow(["div{@media (hover:hover){color:", 0, "}}"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0, 0, 0],
				propertyName: "color",
				priority: "",
				valueParts: [0],
			},
		]);
		expect(plan.ruleCountChecks).toEqual([
			{ rulePath: [0, 0], expectedRuleCount: 1 },
			{ rulePath: [0], expectedRuleCount: 1 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("a hole in a keyframe declaration addresses the keyframe block", () => {
		const plan = compileOrThrow(["@keyframes spin{to{transform:rotate(", 0, "deg)}}"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0, 0],
				propertyName: "transform",
				priority: "",
				valueParts: ["rotate(", 0, "deg)"],
			},
		]);
		expect(plan.ruleCountChecks).toEqual([
			{ rulePath: [0], expectedRuleCount: 1 },
			{ rulePath: [], expectedRuleCount: 1 },
		]);
	});

	test("a prelude-less @scope scopes rules with distinct per-instance sheets", () => {
		const plan = compileOrThrow(["@scope{.dot{background:", 0, "}}"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0, 0],
				propertyName: "background",
				priority: "",
				valueParts: [0],
			},
		]);
	});

	test("a statement at-rule occupies a rule slot", () => {
		const plan = compileOrThrow(["@import url(x.css);.a{color:", 0, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [1], propertyName: "color", priority: "", valueParts: [0] },
		]);
		expect(plan.ruleCountChecks).toEqual([{ rulePath: [], expectedRuleCount: 2 }]);
	});

	test("a @layer statement occupies a rule slot", () => {
		const plan = compileOrThrow(["@layer a, b;.x{color:", 0, "}"]);
		expect(plan.declarations[0].rulePath).toEqual([1]);
	});

	test("a bare holed declaration directly inside top-level @media bails", () => {
		expect(compileStyleSheet(["@media screen{color:", 0, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a hole inside @font-face bails — descriptors are not addressable", () => {
		expect(compileStyleSheet(["@font-face{src:", 0, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a hole inside @property bails", () => {
		expect(compileStyleSheet(["@property --x{initial-value:", 0, "}"])).toBe(
			STYLE_SHEET_NOT_COMPILED,
		);
	});

	test("descriptor at-rule names are case-insensitive", () => {
		expect(compileStyleSheet(["@FONT-FACE{src:", 0, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a holed !important inside a keyframe bails: the browser drops it", () => {
		expect(compileStyleSheet(["@keyframes spin{to{opacity:", 0, " !important}}"])).toBe(
			STYLE_SHEET_NOT_COMPILED,
		);
	});

	test("a hole after a closed descriptor block is fast again", () => {
		const plan = compileOrThrow(["@font-face{src:url(x.woff2)}.a{color:", 0, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [1], propertyName: "color", priority: "", valueParts: [0] },
		]);
		expect(plan.ruleCountChecks).toEqual([{ rulePath: [], expectedRuleCount: 2 }]);
	});
});

describe("value edge whitespace", () => {
	test("whitespace around the value is trimmed, inside it is kept", () => {
		const plan = compileOrThrow(["div{--offset:\n\t ", 0, "px  ", 1, "px \t\n}"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0],
				propertyName: "--offset",
				priority: "",
				valueParts: [0, "px  ", 1, "px"],
			},
		]);
	});

	test("only CSS whitespace is trimmed, a no-break space is value text", () => {
		const plan = compileOrThrow(["div{content: ", 0, "}"]);
		expect(plan.declarations[0].valueParts).toEqual([" ", 0]);
	});
});

describe("!important", () => {
	test("a static trailing !important becomes the priority argument", () => {
		const plan = compileOrThrow(["div{color:", 0, " !important}"]);
		expect(plan.declarations).toEqual([
			{
				rulePath: [0],
				propertyName: "color",
				priority: "important",
				valueParts: [0],
			},
		]);
	});

	test("a top-level bang that is not !important bails", () => {
		expect(compileStyleSheet(["div{color:", 0, " !imp}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("two top-level bangs bail", () => {
		expect(compileStyleSheet(["div{color:", 0, " !important !important}"])).toBe(
			STYLE_SHEET_NOT_COMPILED,
		);
	});

	test("a bang before a hole bails", () => {
		expect(compileStyleSheet(["div{color: x !", 0, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a bang in a hole-free declaration is fine", () => {
		const plan = compileOrThrow(["div{color: red !important; width:", 0, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("a trailing comment after !important in a holed declaration bails", () => {
		expect(compileStyleSheet(["div{color:", 0, " !important /* note */}"])).toBe(
			STYLE_SHEET_NOT_COMPILED,
		);
	});
});

describe("structural bails", () => {
	test("a hole in a selector bails", () => {
		expect(compileStyleSheet(["div.", 0, "{color:red}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a hole in a property name bails", () => {
		expect(compileStyleSheet(["div{", 0, ":red}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a hole in an at-rule prelude bails", () => {
		expect(compileStyleSheet(["@media (min-width:", 0, "px){div{color:red}}"])).toBe(
			STYLE_SHEET_NOT_COMPILED,
		);
	});

	test("a whole-stylesheet hole bails", () => {
		expect(compileStyleSheet(["", 0, ""])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("an unclosed rule bails", () => {
		expect(compileStyleSheet(["div{color:", 0, ";"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a sheet ending inside a value bails", () => {
		expect(compileStyleSheet(["div{color:", 0, ""])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a stray closing brace bails", () => {
		expect(compileStyleSheet(["div{color:red}}.a{width:", 0, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});
});

describe("strings and comments", () => {
	test("a hole inside a string bails", () => {
		expect(compileStyleSheet(['div{content:"', 0, '"}'])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a semicolon inside a string is not a terminator", () => {
		const plan = compileOrThrow(['div{content:"a;b";width:', 0, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("a hole inside a comment bails", () => {
		expect(compileStyleSheet(["div{/* ", 0, " */}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("braces inside a comment are inert", () => {
		const plan = compileOrThrow(["div{/* } */width:", 0, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test('"/*/" does not close its own comment', () => {
		const plan = compileOrThrow(["div{/*/ width:red*/height:", 0, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "height", priority: "", valueParts: [0] },
		]);
	});

	test("an unterminated string bails", () => {
		expect(compileStyleSheet(['div{content:"a}', 0, ""])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("an escaped backslash does not swallow the closing quote", () => {
		const plan = compileOrThrow(['div{content:"a\\\\";width:', 0, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("a comment inside a holed value is kept in the value parts", () => {
		const plan = compileOrThrow(["div{color:/* c */", 0, "}"]);
		expect(plan.declarations).toEqual([
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
		const plan = compileOrThrow([".a{background:url(img;x.png);width:", 0, "}"]);
		expect(plan.declarations).toEqual([
			{ rulePath: [0], propertyName: "width", priority: "", valueParts: [0] },
		]);
	});

	test("an unclosed parenthesis bails", () => {
		expect(compileStyleSheet([".a{width:calc(", 0, "}"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	//the browser reads `({)` as a block still open, so the `;` and what follows join the value
	test("a brace opened inside parentheses swallows the next declaration", () => {
		expect(compileStyleSheet([".a{transform:translateX(", 0, "px {);opacity:", 1, "}"])).toBe(
			STYLE_SHEET_NOT_COMPILED,
		);
	});

	test("a bracket closes only its own block", () => {
		const plan = compileOrThrow([".a{width:", 0, " [a);b]}"]);
		expect(plan.declarations[0].valueParts).toEqual([0, " [a);b]"]);
	});

	test("an unclosed parenthesis in an at-rule's prelude bails", () => {
		expect(compileStyleSheet([".a{width:", 0, "}@media (x"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("a backslash that ends the sheet bails instead of reading past the end", () => {
		expect(compileStyleSheet([".a{width:", 0, "}\\"])).toBe(STYLE_SHEET_NOT_COMPILED);
	});

	test("an escaped semicolon stays inside the value", () => {
		const plan = compileOrThrow([".a{--v:", 0, " \\;}"]);
		expect(plan.declarations[0].valueParts).toEqual([0, " \\;"]);
	});
});

describe("parser reuse", () => {
	test("two compilations do not share state", () => {
		const firstPlan = compileOrThrow(["div{.b{color:red}width:", 0, "}"]);
		const secondPlan = compileOrThrow(["p{color:", 0, "}"]);
		expect(firstPlan.declarations[0].rulePath).toEqual([0, 1]);
		expect(secondPlan.declarations).toEqual([
			{ rulePath: [0], propertyName: "color", priority: "", valueParts: [0] },
		]);
		expect(secondPlan.ruleCountChecks).toEqual([{ rulePath: [], expectedRuleCount: 1 }]);
	});
});

describe("holed rules", () => {
	test("declarations of one block share one holed rule", () => {
		const compiled = compiledOrThrow([".a{width:", 0, ";color:red;height:", 1, "}"]);
		expect(compiled.holedRules).toHaveLength(1);
		expect(compiled.holedRules[0].declarations).toHaveLength(2);
		expect(compiled.declarationCount).toBe(2);
	});

	test("a rule's own block and its nested-declarations run are two holed rules", () => {
		const compiled = compiledOrThrow(["div{width:", 0, ";.b{color:red}height:", 1, "}"]);
		expect(compiled.holedRules.map((holedRule) => holedRule.rulePath)).toEqual([[0], [0, 1]]);
	});

	test("a rule that cannot match the host is never re-inserted", () => {
		const compiled = compiledOrThrow([".inner{--x:", 0, "}"]);
		expect(compiled.holedRules[0].reinsertedRulePath).toBe(NO_REINSERTION);
	});

	test("a :host rule is re-inserted at its own path", () => {
		const compiled = compiledOrThrow(["@media all{:host{--x:", 0, "}}"]);
		expect(compiled.holedRules[0].reinsertedRulePath).toEqual([0, 0]);
	});

	test("a run inside a :host rule re-inserts the :host rule", () => {
		const compiled = compiledOrThrow([":host{.b{color:red}--x:", 0, "}"]);
		expect(compiled.holedRules[0].rulePath).toEqual([0, 1]);
		expect(compiled.holedRules[0].reinsertedRulePath).toEqual([0]);
	});

	test(":scope can match the host, so it is re-inserted", () => {
		const compiled = compiledOrThrow(["@scope{:scope{--x:", 0, "}}"]);
		expect(compiled.holedRules[0].reinsertedRulePath).toEqual([0, 0]);
	});

	test("holes keep the value indexes they were given", () => {
		const compiled = compiledOrThrow([".a{width:", 3, ";height:", 7, "}"]);
		expect(
			compiled.holedRules[0].declarations.map((declaration) => declaration.valueParts),
		).toEqual([[3], [7]]);
	});
});
