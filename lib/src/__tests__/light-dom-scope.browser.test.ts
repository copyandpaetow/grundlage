import { expect, test } from "vitest";

//the platform measurement PLAN §2 rests on, kept executable because R4's whole idiom follows from
//it: `:host` and `:scope` are disjoint, so the pair is a selector list rather than a rewrite.
//happy-dom has no cascade to ask — it returns the authored string and ignores @scope entirely
const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

const mount = (markup: string): HTMLElement => {
	const holder = document.createElement("div");
	holder.innerHTML = markup;
	document.body.append(holder);
	return holder;
};

//not inherited, so a descendant reading it means the selector matched that descendant and not
//its ancestor — `color` cannot tell those apart
const paintOf = (element: Element): string =>
	getComputedStyle(element).getPropertyValue("background-color");

const RED = "rgb(255, 0, 0)";
const UNPAINTED = "rgba(0, 0, 0, 0)";

test.skipIf(!isRealBrowser)("@scope parses and survives insertion", () => {
	const sheet = new CSSStyleSheet();
	sheet.insertRule("@scope to (*) { :scope { background: red } }");
	expect(sheet.cssRules.length).toBe(1);
});

test.skipIf(!isRealBrowser)(
	"inside the wrap, :scope matches the host and :host matches nothing",
	() => {
		const holder = mount(`
			<user-card light-dom>
				<style>
					@scope to (:scope [light-dom] *) {
						:scope { background: red }
						:host { background: blue }
						button { background: red }
					}
				</style>
				<button>x</button>
			</user-card>`);
		//equal specificity and :host is the later rule, so blue is what a match would paint
		expect(paintOf(holder.querySelector("user-card")!)).toBe(RED);
		expect(paintOf(holder.querySelector("button")!)).toBe(RED);
	},
);

test.skipIf(!isRealBrowser)(
	"in a shadow root it is the other way round: :host matches, :scope matches nothing",
	() => {
		const holder = mount(`<user-card></user-card>`);
		const host = holder.querySelector("user-card")!;
		host.attachShadow({ mode: "open" }).innerHTML =
			`<style>:scope { background: blue } :host { background: red }</style>`;
		expect(paintOf(host)).toBe(RED);

		const other = mount(`<other-card></other-card>`);
		const otherHost = other.querySelector("other-card")!;
		const otherRoot = otherHost.attachShadow({ mode: "open" });
		otherRoot.innerHTML = `<style>:scope { background: blue }</style><b>x</b>`;
		expect(paintOf(otherHost)).toBe(UNPAINTED);
		expect(paintOf(otherRoot.querySelector("b")!)).toBe(UNPAINTED);
	},
);

test.skipIf(!isRealBrowser)(
	"a member that cannot match is inert, so one authored pair covers both modes",
	() => {
		const light = mount(`
			<a-card light-dom>
				<style>@scope to (:scope [light-dom] *) { :host, :scope { background: red } }</style>
			</a-card>`);
		expect(paintOf(light.querySelector("a-card")!)).toBe(RED);

		const shadow = mount(`<b-card></b-card>`);
		const host = shadow.querySelector("b-card")!;
		host.attachShadow({ mode: "open" }).innerHTML =
			`<style>:host, :scope { background: red }</style>`;
		expect(paintOf(host)).toBe(RED);
	},
);

test.skipIf(!isRealBrowser)(
	"every other selector is descendants-only: a bare tag rule does not reach the host",
	() => {
		const holder = mount(`
			<f-card light-dom>
				<style>@scope to (:scope [light-dom] *) { f-card { background: blue } }</style>
			</f-card>`);
		expect(paintOf(holder.querySelector("f-card")!)).toBe(UNPAINTED);
	},
);

test.skipIf(!isRealBrowser)(
	"R5: a nested light host is styleable, its interior is not",
	() => {
		const holder = mount(`
			<outer-card light-dom>
				<style>
					@scope to (:scope [light-dom] *) {
						inner-card { background: red }
						b { background: red }
					}
				</style>
				<inner-card light-dom><b>note</b></inner-card>
				<b>own</b>
			</outer-card>`);
		expect(paintOf(holder.querySelector("inner-card")!)).toBe(RED);
		expect(paintOf(holder.querySelector("outer-card > b")!)).toBe(RED);
		expect(paintOf(holder.querySelector("inner-card b")!)).toBe(UNPAINTED);
	},
);

test.skipIf(!isRealBrowser)(
	"both halves of the limit are load-bearing: to ([light-dom]) alone loses the nested host",
	() => {
		const holder = mount(`
			<d-card light-dom>
				<style>@scope to ([light-dom]) { inner-card { background: red } }</style>
				<inner-card light-dom><b>note</b></inner-card>
			</d-card>`);
		expect(paintOf(holder.querySelector("inner-card")!)).toBe(UNPAINTED);
	},
);

test.skipIf(!isRealBrowser)(
	"a nested shadow child stops the parent's rules on its own",
	() => {
		const holder = mount(`
			<e-card light-dom>
				<style>@scope to (:scope [light-dom] *) { b { background: red } }</style>
				<shadow-child></shadow-child>
			</e-card>`);
		const child = holder.querySelector("shadow-child")!;
		child.attachShadow({ mode: "open" }).innerHTML = `<b>note</b>`;
		expect(paintOf(child.shadowRoot!.querySelector("b")!)).toBe(UNPAINTED);
	},
);

test.skipIf(!isRealBrowser)(
	"R6: the tag-name fallback contains the descendant rules and drops the host rule",
	() => {
		const holder = mount(`
			<c-card light-dom>
				<style>c-card { :scope { background: blue } button { background: red } }</style>
				<button>x</button>
			</c-card>`);
		expect(paintOf(holder.querySelector("button")!)).toBe(RED);
		expect(paintOf(holder.querySelector("c-card")!)).toBe(UNPAINTED);
		expect(paintOf(document.documentElement)).toBe(UNPAINTED);
	},
);

test.skipIf(!isRealBrowser)(
	"R6's fallback has no lower limit, so R5 does not hold on that branch",
	() => {
		const holder = mount(`
			<g-card light-dom>
				<style>g-card { b { background: red } }</style>
				<inner-card light-dom><b>note</b></inner-card>
			</g-card>`);
		expect(paintOf(holder.querySelector("inner-card b")!)).toBe(RED);
	},
);
