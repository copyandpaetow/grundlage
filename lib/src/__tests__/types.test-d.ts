//type-level fixture. It is never executed — `tsc --noEmit` is the assertion. A negative case is
//pinned with @ts-expect-error, which fails the build if the error goes away, unless it has to
//survive an API that has not landed yet: those read assignability as a value instead
import { awaited, component, html, prop } from "../index";
import { ComponentOptions, Template, YieldableValue } from "../types";

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
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	{
		props: {
			start: prop.attribute(Number, 0),
			label: prop.optional(prop.attribute(String)),
			disabled: prop.attribute(Boolean),
			header: prop.optional(prop.attribute(asTemplate)),
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
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	{ props: { header: prop.attribute(asTemplate, {} as Template) } },
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
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	{ props: { start: prop.attribute(Number, 0) } },
);

//a prop used at the wrong type
export const wrongUse = component(
	function* ({ start }) {
		//@ts-expect-error start is a number
		const wrong: string = start;
		void wrong;
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	{ props: { start: prop.attribute(Number, 0) } },
);

//a key the schema does not declare
export const undeclaredKey = component(
	//@ts-expect-error `missing` is not in the schema
	function* ({ missing }) {
		void missing;
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	{ props: { start: prop.attribute(Number, 0) } },
);

//options omitted: the object is just { host }
export const noOptions = component(function* (componentProps) {
	const onlyHost: Exact<keyof typeof componentProps, "host"> = true;
	void onlyHost;
	yield function* () {
		yield html`<p>x</p>`;
	};
});

//a function taking a narrower parameter cannot be asked what an attribute holds
export const narrowParameter = component(
	function* () {
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	{
		props: {
			//@ts-expect-error every incoming value arrives as unknown
			variant: prop.optional(prop.attribute((incoming: string) => incoming)),
		},
	},
);

//an entry that is not callable at all
export const notAFunction = component(
	function* () {
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	//@ts-expect-error a schema entry is a token or a function
	{ props: { variant: prop.optional(prop.attribute("solid")) } },
);

//a predicate is not a special shape — it is a function whose value happens to be a boolean
export const predicateEntry = component(
	function* ({ variant }) {
		const exact: Exact<typeof variant, boolean | undefined> = true;
		void exact;
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	{
		props: {
			variant: prop.optional(
				prop.attribute((incoming: unknown) => typeof incoming === "string"),
			),
		},
	},
);

//a fallback is checked against what the parser produces
export const fallbackIsTypeChecked = component(
	function* () {
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	{
		props: {
			//@ts-expect-error a String prop's fallback is a string
			label: prop.attribute(String, []),
			//@ts-expect-error a fallback is one of the values the parser returns
			variant: prop.attribute(asVariant, "nope"),
		},
	},
);

//light mode's type-level half, R1. The union PLAN §1 specifies rejects `delegatesFocus` by
//excess-property checking, which fires on an object literal and is invisible to a conditional
//type, so the shadow-only options are pinned as calls and only the mode itself is read as a value
type LightModeShips = "light" extends ComponentOptions["mode"] ? true : false;

export const lightIsAMode: Exact<
	{ mode: "light" } extends ComponentOptions ? true : false,
	LightModeShips
> = true;

//satisfied today because `mode` is still `ShadowRootMode`, and after the split because the light
//branch has no such key. An implementation that only widened `mode` leaves the directive unused,
//which is itself an error — so the one shape this must never accept cannot slip through
export const focusIsShadowOnly = component(
	function* () {
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	//@ts-expect-error delegatesFocus is shadow-only
	{ mode: "light", delegatesFocus: true },
);

export const shadowStillTakesFocus = component(
	function* () {
		yield function* () {
			yield html`<p>x</p>`;
		};
	},
	{ mode: "open", delegatesFocus: true },
);

type User = { name: string };
declare const fetchUser: () => Promise<User>;

//a generator has one resume type, so a bare yield cannot name the promise's value: it reads as
//unknown rather than any, and `yield* awaited` is the typed spelling
export const waitedValues = component(function* () {
	const bare = yield fetchUser();
	const bareIsUnknown: Exact<typeof bare, unknown> = true;
	const bareNotAny: Exact<IsAny<typeof bare>, false> = true;
	//@ts-expect-error an annotation on a bare yield is not checked, so it is refused
	const annotated: User = yield fetchUser();
	const user = yield* awaited(fetchUser());
	const typed: Exact<typeof user, User> = true;
	void [bareIsUnknown, bareNotAny, annotated, typed];
	yield function* view() {
		const inUpdateGenerator = yield* awaited(fetchUser());
		const typedInUpdateGenerator: Exact<typeof inUpdateGenerator, User> = true;
		void typedInUpdateGenerator;
		yield html`<p>${inUpdateGenerator.name}</p>`;
	};
});

//a helper typed by hand sends unknown, which a delegate expecting its own value type would refuse
export function* readUserInHelper(): Generator<YieldableValue, User, unknown> {
	return yield* awaited(fetchUser());
}
