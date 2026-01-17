import { expect, test } from "vitest";
import { css } from "../../parser-css";

test("css rule parser", () => {
	expect(css.rule`opacity: 1, margin: ${12}px`).toStrictEqual([
		{
			bindings: [{ type: "declaration", value: 12 }],
			selector: "",
			text: ["opacity: 1, margin: ", "px"],
			type: "rule",
		},
	]);

	expect(css.rule`opacity: 1, ${"margin"}: 12px`).toStrictEqual([
		{
			bindings: [{ type: "declaration", value: "margin" }],
			selector: "",
			text: ["opacity: 1, ", ": 12px"],
			type: "rule",
		},
	]);
});
