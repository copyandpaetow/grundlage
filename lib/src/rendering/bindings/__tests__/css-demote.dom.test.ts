import { describe, expect, test } from "vitest";
import { BINDING } from "../../../parser/constants";
import {
	CompiledStyleSheet,
	RawContentStaticBinding,
} from "../../../parser/types";
import { UNSET_HASH } from "../../constants";
import { commitRawContent } from "../content-raw";
import { createStyleSheetState } from "../css-apply";
import { RawContentLiveBinding } from "../types";

//a <style> whose live sheet parses to a different rule count than the compiler recorded
//demotes to the full-text lane. The demotion nulls styleSheetState mid-commit, so the
//text-lane seed step must read the live field, not a stale local, or it dereferences null
describe("css demotion to the full-text lane", () => {
	const buildConnectedStyleBinding = (
		cssText: string,
		compiledStyleSheet: CompiledStyleSheet,
	): { liveBinding: RawContentLiveBinding; style: HTMLStyleElement } => {
		const container = document.createElement("div");
		const marker = document.createComment("^.^ style");
		const style = document.createElement("style");
		style.textContent = cssText;
		container.append(marker, style);
		document.body.append(container);

		const staticBinding: RawContentStaticBinding = {
			type: BINDING.RAW_CONTENT,
			parts: ["p { color: ", 0, "; }"],
			compiledStyleSheet,
		};
		const liveBinding: RawContentLiveBinding = {
			staticBinding,
			markerComment: marker,
			lastValueHash: UNSET_HASH,
			styleSheetState: createStyleSheetState(compiledStyleSheet, style),
		};
		return { liveBinding, style };
	};

	//expectedRuleCount can never match the one rule the browser parses, so the first
	//connected commit re-resolves, fails, and demotes — the exact path that crashed
	const mismatchingCompiled: CompiledStyleSheet = {
		dynamicDeclarations: [
			{ rulePath: [0], propertyName: "color", priority: "", valueParts: [0] },
		],
		ruleCountChecks: [{ rulePath: [], expectedRuleCount: 99 }],
	};

	test("a structure mismatch demotes without throwing and rewrites the text", () => {
		const { liveBinding, style } = buildConnectedStyleBinding(
			"p { color: red; }",
			mismatchingCompiled,
		);
		expect(style.sheet).not.toBeNull();

		expect(() => commitRawContent(liveBinding, ["blue"])).not.toThrow();

		//the CSSOM lane is gone and the fallback rewrote the whole sheet text
		expect(liveBinding.styleSheetState).toBeNull();
		expect(style.textContent).toBe("p { color: blue; }");

		style.parentElement!.remove();
	});

	test("the demoted binding stays on the text lane on later updates", () => {
		const { liveBinding, style } = buildConnectedStyleBinding(
			"p { color: red; }",
			mismatchingCompiled,
		);

		commitRawContent(liveBinding, ["blue"]);
		expect(() => commitRawContent(liveBinding, ["green"])).not.toThrow();
		expect(liveBinding.styleSheetState).toBeNull();
		expect(style.textContent).toBe("p { color: green; }");

		style.parentElement!.remove();
	});
});
