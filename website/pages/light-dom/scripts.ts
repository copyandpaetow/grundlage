import { lightModeShips, slotsShip } from "../../src/components/light-card";
import "../../src/components/navbar";

type Outcome = "holds" | "broken" | "pending";

//captured by the inline script in index.html, at parse position — the only moment the server's
//markup is still untouched, since a module script is deferred past it
type BeforeUpgrade = {
	hostMarkup: string;
	renderMarkup: string;
	heading: Element | null;
	mutations: Array<MutationRecord>;
};

declare global {
	interface Window {
		beforeUpgrade: Record<string, BeforeUpgrade>;
	}
}

type CheckContext = {
	tag: string;
	host: Element;
	root: ParentNode;
	beforeUpgrade: BeforeUpgrade;
};

type Check = {
	rule: string;
	claim: string;
	needs: Array<"slots" | "a server render">;
	run: (context: CheckContext) => boolean;
};

const wasRenderedOnTheServer = (beforeUpgrade: BeforeUpgrade): boolean =>
	beforeUpgrade.renderMarkup.includes("<!--^.^ ");

//every check is written as the light-mode claim and run against both cards. The shadow column is
//the same code with the boundary switched on, so a ❌ there is where the two modes part
const checks: Array<Check> = [
	{
		rule: "R3",
		claim: "the render is the host's own child list",
		needs: [],
		run: ({ host }) => host.querySelector(":scope > article") !== null,
	},
	{
		rule: "R4",
		claim: "page CSS reaches in",
		needs: [],
		run: ({ root }) =>
			getComputedStyle(root.querySelector("header")!).outlineStyle === "dashed",
	},
	{
		rule: "R4",
		claim: "the component's own rules still apply",
		needs: [],
		run: ({ root }) =>
			getComputedStyle(root.querySelector("header")!).fontWeight === "700",
	},
	{
		rule: "R4",
		claim: "<code>label[for]</code> associates across the host",
		needs: [],
		run: ({ root }) => {
			const input = root.querySelector("input");
			return (
				input !== null &&
				document.querySelector<HTMLLabelElement>(
					"label[for=reached-by-a-label]",
				)?.control === input
			);
		},
	},
	{
		rule: "R4",
		claim: "a <code>:target</code> id responds to fragment navigation",
		needs: [],
		run: ({ root }) =>
			root.querySelector("#reached-by-a-fragment")?.matches(":target") === true,
	},
	{
		rule: "R8",
		claim: "a slot key is a prop and never an attribute",
		needs: ["slots"],
		run: ({ tag }) => {
			const definition = customElements.get(tag) as CustomElementConstructor & {
				observedAttributes: Array<string>;
				declaredPropNames: ReadonlySet<string>;
			};
			return (
				!definition.observedAttributes.includes("heading") &&
				definition.declaredPropNames.has("heading")
			);
		},
	},
	{
		rule: "R11",
		claim: "an adopted node is moved into the render, not copied",
		needs: ["slots"],
		run: ({ root, beforeUpgrade }) =>
			beforeUpgrade.heading !== null &&
			root.querySelector("header > h2") === beforeUpgrade.heading,
	},
	{
		rule: "R12",
		claim: "an assigned slot array is frozen, so a push throws instead of landing",
		needs: ["slots"],
		run: ({ host }) => {
			const heading = (host as Element & { heading?: Array<ChildNode> }).heading;
			if (!Array.isArray(heading)) return false;
			try {
				heading.push(document.createElement("b"));
				return false;
			} catch {
				return true;
			}
		},
	},
	{
		rule: "R13",
		claim: "declaring a slot drains the host's children",
		needs: ["slots"],
		run: ({ host }) => host.querySelector(":scope > [slot=heading]") === null,
	},
	{
		rule: "R14",
		claim: "a child no entry claims is destroyed rather than left in the child list",
		needs: ["slots"],
		run: ({ host }) => host.querySelector("[slot=badges]") === null,
	},
	{
		rule: "R16",
		claim: "a declared fallback shows when nothing was passed",
		needs: ["slots"],
		run: ({ root }) => root.querySelector("footer")?.textContent === "—",
	},
	{
		rule: "R19",
		claim: "a second hole for the same nodes stays empty",
		needs: ["slots"],
		run: ({ root }) => root.querySelector("nav")?.childElementCount === 0,
	},
	{
		rule: "§1.1",
		claim:
			"the server ships <code>light-dom</code>, so page CSS applies before any script runs",
		needs: ["a server render"],
		run: ({ beforeUpgrade }) => beforeUpgrade.hostMarkup.includes("light-dom"),
	},
	{
		rule: "§3.5",
		claim: "the server stamped a slot scope on the host",
		needs: ["slots", "a server render"],
		run: ({ beforeUpgrade }) => beforeUpgrade.hostMarkup.includes("slot-scope="),
	},
	{
		rule: "§3.5",
		claim: "the server bracketed each adopted range with a marker pair",
		needs: ["slots", "a server render"],
		run: ({ beforeUpgrade }) =>
			beforeUpgrade.renderMarkup.includes("<!--^.^ slot-"),
	},
	{
		rule: "§3.5",
		claim: "the claim is a read: hydration wrote nothing into the tree",
		needs: ["a server render"],
		run: ({ beforeUpgrade }) => beforeUpgrade.mutations.length === 0,
	},
];

const rootOf = (host: Element): ParentNode =>
	(host as Element & { renderRoot?: ParentNode }).renderRoot ??
	host.shadowRoot ??
	host;

const outcomeOf = (check: Check, tag: string): Outcome => {
	const host = document.querySelector(tag);
	if (host === null || customElements.get(tag) === undefined) return "pending";
	if (check.needs.includes("slots") && !slotsShip) return "pending";
	const beforeUpgrade = window.beforeUpgrade[tag];
	if (
		check.needs.includes("a server render") &&
		!wasRenderedOnTheServer(beforeUpgrade)
	)
		return "pending";
	try {
		return check.run({ tag, host, root: rootOf(host), beforeUpgrade })
			? "holds"
			: "broken";
	} catch {
		return "broken";
	}
};

const mark = { holds: "✅", broken: "❌", pending: "⏳" } as const;

const render = (): void => {
	document.querySelector("#results tbody")!.innerHTML = checks
		.map((check) => {
			const light = outcomeOf(check, "light-card");
			const shadow = outcomeOf(check, "shadow-card");
			return `<tr>
				<td>${check.rule}</td>
				<td>${check.claim}</td>
				<td class="outcome ${light}">${mark[light]}</td>
				<td class="outcome ${shadow}">${mark[shadow]}</td>
			</tr>`;
		})
		.join("");
};

const stateText = (): string => {
	//the shadow card is the one that can be prerendered today, so it answers for the page
	const hydrationNote = wasRenderedOnTheServer(window.beforeUpgrade["shadow-card"])
		? ""
		: " This page was not prerendered, so the hydration rows read ⏳ — the [prerender] warning in the terminal says why.";
	if (!lightModeShips)
		return `Light mode does not ship yet, so the light column reads ⏳. The shadow column is the problem it exists to solve: page CSS, label[for] and :target cannot cross the boundary, and no component can work around that.${hydrationNote}`;
	return `Light mode ships${slotsShip ? "" : ", slots do not"}. The light column is the specification, and every ✅ is a rule that holds.${hydrationNote}`;
};

document.querySelector("#state")!.textContent = stateText();

//the fragment is what makes the :target check meaningful, and it has to land before the read
location.hash = "#reached-by-a-fragment";
requestAnimationFrame(render);

document.querySelector("#rerun")!.addEventListener("click", render);
