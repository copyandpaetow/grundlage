import { expect, test } from "vitest";
import { component, html } from "../../index";
import { BaseComponent } from "../../types";
import {
	createRandom,
	generateTemplate,
	GeneratedTemplate,
	handWrittenMarkupOf,
} from "./html-template-generator";

//the browser is the oracle: a painted template, markers removed, must equal the markup the app
//would have written by hand with the same values, at mount and after a patch
const isRealBrowser = typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

const CASE_COUNT = 400;

const serializedSheetOf = (sheet: CSSStyleSheet | null) =>
	sheet === null ? "no sheet" : Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");

const scratchSheetOf = (cssText: string) => {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(cssText);
	return sheet;
};

//live state the markup does not show (CSSOM updates, a textarea's value) is written into the copy
const comparableMarkupOf = (
	root: ParentNode,
	liveStyleTextOf: (style: HTMLStyleElement) => string,
	liveTextareaTextOf: (textarea: HTMLTextAreaElement) => string,
) => {
	const styleTexts = Array.from(root.querySelectorAll("style"), liveStyleTextOf);
	const textareaTexts = Array.from(root.querySelectorAll("textarea"), liveTextareaTextOf);
	const container = document.createElement("div");
	for (const child of root.childNodes) container.append(child.cloneNode(true));
	const styles = container.querySelectorAll("style");
	for (let index = 0; index < styles.length; index++) styles[index].textContent = styleTexts[index];
	const textareas = container.querySelectorAll("textarea");
	for (let index = 0; index < textareas.length; index++) {
		textareas[index].textContent = textareaTexts[index];
	}
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
	const markers: Array<Comment> = [];
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node.data.startsWith("^.^ ")) markers.push(node);
	}
	for (const marker of markers) marker.remove();
	container.normalize();
	//the library appends bound attributes after the static ones, an order nothing but serialization sees
	for (const element of container.querySelectorAll("*")) {
		const attributes = Array.from(element.attributes, ({ name, value }) => [name, value]);
		for (const [name] of attributes) element.removeAttribute(name);
		attributes.sort(([first], [second]) => (first < second ? -1 : 1));
		for (const [name, value] of attributes) element.setAttribute(name, value);
	}
	return container.innerHTML;
};

const paintedMarkupOf = (host: BaseComponent) =>
	comparableMarkupOf(
		host.shadowRoot!,
		(style) => serializedSheetOf(style.sheet),
		(textarea) => textarea.value,
	);

const handWrittenComparableMarkupOf = (markup: string) => {
	const parserHost = document.createElement("template");
	parserHost.innerHTML = markup;
	return comparableMarkupOf(
		parserHost.content,
		(style) => serializedSheetOf(scratchSheetOf(style.textContent ?? "")),
		(textarea) => textarea.defaultValue,
	);
};

interface CurrentPaint {
	generated: GeneratedTemplate;
	values: Array<string | number>;
}

const UNSETTLED = "unsettled";
const settledWithin = (update: Promise<void>) =>
	Promise.race([
		update,
		new Promise<typeof UNSETTLED>((resolve) => setTimeout(() => resolve(UNSETTLED), 1000)),
	]);

let currentPaint: CurrentPaint | null = null;
const FUZZ_TAG = "html-oracle-fuzz";
customElements.define(
	FUZZ_TAG,
	component(function* () {
		yield function* view() {
			const { generated, values } = currentPaint!;
			yield html(generated.strings, ...values);
		};
	}),
);

test.runIf(isRealBrowser).each([1, 2, 3])(
	"every painted template matches the hand-written markup, at mount and after a patch (seed %i)",
	async (seed) => {
		const random = createRandom(seed);
		const errors: Array<string> = [];
		const recordError = (event: Event) => {
			event.preventDefault();
			errors.push(String((event as Event & { error: unknown }).error));
		};
		document.addEventListener("grundlage-error", recordError);
		const wrong: Array<string> = [];
		const tally = { cases: 0, holes: 0, patched: 0, refusedNesting: 0 };
		for (let caseIndex = 0; caseIndex < CASE_COUNT && wrong.length < 6; caseIndex++) {
			const generated = generateTemplate(random);
			const firstValues = generated.valuesOf(random);
			const nextValues = generated.valuesOf(random);
			tally.cases++;
			tally.holes += firstValues.length;
			const source = generated.strings.join("${}");
			const errorCountBefore = errors.length;
			const host = document.createElement(FUZZ_TAG) as BaseComponent;
			currentPaint = { generated, values: firstValues };
			document.body.append(host);
			if ((await settledWithin(host.update())) === UNSETTLED) {
				wrong.push(`mount never settled in ${source}`);
				host.remove();
				continue;
			}
			const compare = (values: Array<string | number>, label: string) => {
				const isRefusedNesting =
					errors.length === errorCountBefore + 1 &&
					errors[errorCountBefore].includes("was moved by the HTML parser");
				if (isRefusedNesting) {
					tally.refusedNesting++;
					return false;
				}
				if (errors.length > errorCountBefore) {
					wrong.push(`${label} threw ${errors.at(-1)} in ${source}`);
					return false;
				}
				const painted = paintedMarkupOf(host);
				const handWritten = handWrittenComparableMarkupOf(handWrittenMarkupOf(generated, values));
				if (painted === handWritten) return true;
				wrong.push(
					`${label} in ${source} with ${JSON.stringify(values)}\n  painted:      ${painted}\n  hand-written: ${handWritten}`,
				);
				return false;
			};
			if (compare(firstValues, "mount")) {
				currentPaint = { generated, values: nextValues };
				if ((await settledWithin(host.update())) === UNSETTLED) {
					wrong.push(`patch never settled in ${source}`);
				} else if (compare(nextValues, "patch")) tally.patched++;
			}
			host.remove();
		}
		document.removeEventListener("grundlage-error", recordError);
		expect({ tally, wrong }).toEqual({ tally, wrong: [] });
	},
	60_000,
);
