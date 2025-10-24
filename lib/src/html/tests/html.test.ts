import { expect, test } from "vitest";
import { parseTemplate } from "../../rendering/html";

const getTemplateStringArray = (
	tokens: TemplateStringsArray,
	..._: Array<unknown>
) => {
	return tokens;
};

test("html parser", () => {
	expect(
		parseTemplate(getTemplateStringArray`<div data-test="${123}"></div>`)
	).toStrictEqual([
		{
			template: [],
			indices: [],
			type: "ATTR",
			closingChar: "",
		},
	]);
});
