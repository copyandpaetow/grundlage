import { expect, test } from "vitest";
import { splitStylesIntoRules } from "../split-rules";

const getTemplateStringArray = (
	tokens: TemplateStringsArray,
	..._: Array<unknown>
) => {
	return tokens;
};

const normalizeWhitespace = (str: string) => {
	return str.replace(/[\t\n\r\f]+/g, " ");
};

// const singleRule = getTemplateStringArray`.card {
//   opacity: 1;
//   margin: ${12}px
// }`;

const singleRuleWithMediaQueries = getTemplateStringArray`
.card {
  @media screen and (width > ${600}px) {
    opacity: 1;
    margin: ${12}px
  }
}`;

test("css rule parser", () => {
	const result = splitStylesIntoRules(singleRuleWithMediaQueries).map((entry) =>
		entry.text.map(normalizeWhitespace)
	);
	console.log(splitStylesIntoRules(singleRuleWithMediaQueries));

	expect(result).toStrictEqual([
		[
			".card {   @media screen and (width > ",
			"px) {     opacity: 1;     margin: ",
			"px   } }",
		],
	]);
});

const singleRuleWithToplevelImports = getTemplateStringArray`

${"someOtherRule"}
@import ${"someUrl"};

.card {
    opacity: 1;
    margin: ${12}px
}`;

test("css rule parser 2", () => {
	const result = splitStylesIntoRules(singleRuleWithToplevelImports).map(
		(entry) => entry.text.map(normalizeWhitespace)
	);

	expect(result).toStrictEqual([
		["", ""],
		[" @import ", ";"],
		[" .card {     opacity: 1;     margin: ", "px }"],
	]);
});
