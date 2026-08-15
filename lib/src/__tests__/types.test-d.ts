//type-level fixture. It is never executed — `tsc --noEmit` is the assertion, and every
//negative case is pinned with @ts-expect-error, which fails the build if the error goes away
import { component, html } from "../index";
import { Template } from "../types";

type IsAny<Type> = 0 extends 1 & Type ? true : false;

//bidirectional: a positive case passing because everything widened to `any` is the failure this
//API would most plausibly have, so `Exact` and `IsAny` are asserted separately
type Exact<Actual, Wanted> = [Actual] extends [Wanted]
	? [Wanted] extends [Actual]
		? true
		: { actual: Actual; wanted: Wanted }
	: { actual: Actual; wanted: Wanted };

type Variant = "solid" | "outline";
declare const asVariant: (incoming: unknown) => Variant | undefined;
declare const asTemplate: (incoming: unknown) => Template | undefined;

//every entry shape resolves to exactly its value type, and none of them is `any`
export const everyEntryShape = component(
	function* ({ host, start, label, disabled, header }) {
		const one: Exact<typeof start, number> = true;
		const two: Exact<typeof label, string | undefined> = true;
		const three: Exact<typeof disabled, boolean> = true;
		const four: Exact<typeof header, Template | undefined> = true;
		const notAny: Exact<IsAny<typeof start>, false> = true;
		const hostIsTheElement: Exact<
			ReturnType<typeof host.update>,
			Promise<void>
		> = true;
		void [one, two, three, four, notAny, hostIsTheElement];
		yield () => html`<p>x</p>`;
	},
	{
		props: {
			start: [Number, 0],
			label: String,
			disabled: Boolean,
			header: asTemplate,
		},
	},
);

//a fallback subtracts `undefined`, which is the only thing the type layer can see about a function
export const fallbackSubtractsUndefined = component(
	function* ({ header }) {
		const narrowed: Exact<typeof header, Template> = true;
		//@ts-expect-error the fallback took `| undefined` off
		const widened: Exact<typeof header, Template | undefined> = true;
		void [narrowed, widened];
		yield () => html`<p>x</p>`;
	},
	{ props: { header: [asTemplate, {} as Template] } },
);

//the two halves read alike and write apart: the props object is the store, so assigning to it
//would move a value nothing parsed, reflected or scheduled on
export const writingGoesThroughHost = component(
	function* (componentProps) {
		//@ts-expect-error the props object is the store, not a way into it
		componentProps.start = 5;
		componentProps.host.start = 5;
		const hostCarriesTheProps: Exact<typeof componentProps.host.start, number> =
			true;
		void hostCarriesTheProps;
		yield () => html`<p>x</p>`;
	},
	{ props: { start: [Number, 0] } },
);

//a prop used at the wrong type
export const wrongUse = component(
	function* ({ start }) {
		//@ts-expect-error start is a number
		const wrong: string = start;
		void wrong;
		yield () => html`<p>x</p>`;
	},
	{ props: { start: [Number, 0] } },
);

//a key the schema does not declare
export const undeclaredKey = component(
	//@ts-expect-error `missing` is not in the schema
	function* ({ missing }) {
		void missing;
		yield () => html`<p>x</p>`;
	},
	{ props: { start: [Number, 0] } },
);

//options omitted: the object is just { host }
export const noOptions = component(function* (componentProps) {
	const onlyHost: Exact<keyof typeof componentProps, "host"> = true;
	void onlyHost;
	yield () => html`<p>x</p>`;
});

//a function taking a narrower parameter cannot be asked what an attribute holds
export const narrowParameter = component(
	function* () {
		yield () => html`<p>x</p>`;
	},
	//@ts-expect-error every incoming value arrives as unknown
	{ props: { variant: (incoming: string) => incoming } },
);

//an entry that is not callable at all
export const notAFunction = component(
	function* () {
		yield () => html`<p>x</p>`;
	},
	//@ts-expect-error a schema entry is a token or a function
	{ props: { variant: "solid" } },
);

//a predicate is not a special shape — it is a function whose value happens to be a boolean
export const predicateEntry = component(
	function* ({ variant }) {
		const exact: Exact<typeof variant, boolean | undefined> = true;
		void exact;
		yield () => html`<p>x</p>`;
	},
	{ props: { variant: (incoming: unknown) => typeof incoming === "string" } },
);

//deliberately allowed: a fallback of the wrong type is a define-time throw, not a compile error,
//which is what keeps the schema's own error messages readable
export const fallbackIsNotTypeChecked = component(
	function* ({ label, variant }) {
		const stillItsOwnType: Exact<typeof label, string> = true;
		const guardedType: Exact<typeof variant, Variant> = true;
		void [stillItsOwnType, guardedType];
		yield () => html`<p>x</p>`;
	},
	{ props: { label: [String, []], variant: [asVariant, "nope"] } },
);
