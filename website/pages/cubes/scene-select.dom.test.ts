import { afterEach, beforeEach, describe, expect, test } from "vitest";
import "./wrappers/scene-select";

// Behaviour tests for the selection cage. Its whole observable output is the box geometry
// it publishes as :host custom properties, measured from the blocks assigned to its slot.
//
// The measurement is the point of these tests. Blocks only assign once the <slot> is in
// the shadow tree, so the cage paints twice per render: once to put the slot up, then
// again with the box that measuring produced. A cage that measured before painting would
// always be one render behind, and a freshly mounted one would show nothing at all.
//
// Both paints come from the same template, so the second is a CSSOM patch rather than a
// remount. That is why assertions read the live sheet and not the <style> text: the text
// is the mount-time write (the first paint), the CSSOM rule is where later paints land.

const HALF_UNIT = 60;
const CAGE_MARGIN = 6;

let cage: HTMLElement & { update: () => Promise<void> };

const flush = (): Promise<void> =>
	new Promise((resolve) => queueMicrotask(resolve));

// A leaf block the way the geometries render one: a resolved `transform` matrix plus the
// pre-scale half-extents. Left un-upgraded on purpose, so the cage measures a stand-in and
// nothing depends on the shapes' own rendering.
const makeLeaf = (offsetX: number): HTMLElement => {
	const leaf = document.createElement("scene-cube");
	leaf.style.transform = `translate3d(${offsetX}px, 0px, 0px)`;
	leaf.style.setProperty("--block-extent-x", `${HALF_UNIT}px`);
	leaf.style.setProperty("--block-extent-y", `${HALF_UNIT}px`);
	leaf.style.setProperty("--block-extent-z", `${HALF_UNIT}px`);
	return leaf;
};

const hostRule = (): CSSStyleDeclaration => {
	const sheet = cage.shadowRoot?.querySelector("style")?.sheet;
	for (const rule of Array.from(sheet?.cssRules ?? [])) {
		const styleRule = rule as CSSStyleRule;
		if (styleRule.selectorText === ":host") return styleRule.style;
	}
	throw new Error("the cage published no :host rule");
};

const boxVariable = (name: string): string =>
	hostRule().getPropertyValue(name).trim();

beforeEach(() => {
	cage = document.createElement("scene-select") as typeof cage;
});

afterEach(() => {
	cage.remove();
	document.body.innerHTML = "";
});

describe("measuring what it just painted", () => {
	test("a cage mounted around blocks fits them on its first render", async () => {
		cage.append(makeLeaf(0), makeLeaf(240));
		document.body.appendChild(cage);
		await flush();

		// The two leaves span -60..300 on x, so the box centres at 120 and reaches 180.
		expect(boxVariable("--box-display")).toBe("block");
		expect(boxVariable("--center-x")).toBe("120px");
		expect(boxVariable("--half-x")).toBe(`${180 + CAGE_MARGIN}px`);
		expect(boxVariable("--half-y")).toBe(`${HALF_UNIT + CAGE_MARGIN}px`);
	});

	test("the first paint is the one that goes up as sheet text", async () => {
		cage.append(makeLeaf(0));
		document.body.appendChild(cage);
		await flush();

		const text = cage.shadowRoot?.querySelector("style")?.textContent ?? "";
		expect(text).toContain("--box-display: none");
		expect(boxVariable("--box-display")).toBe("block");
	});

	test("a block folded in after mount is measured on the next render", async () => {
		document.body.appendChild(cage);
		await flush();
		expect(boxVariable("--box-display")).toBe("none");

		cage.appendChild(makeLeaf(0));
		await cage.update();

		expect(boxVariable("--box-display")).toBe("block");
		expect(boxVariable("--half-x")).toBe(`${HALF_UNIT + CAGE_MARGIN}px`);
	});

	test("a cage holding nothing hides the box rather than drawing a zero one", async () => {
		document.body.appendChild(cage);
		await flush();

		expect(boxVariable("--box-display")).toBe("none");
		expect(cage.shadowRoot?.querySelector(".box")).not.toBeNull();
	});
});

describe("the slot survives the measure", () => {
	test("both paints keep the same slot node, so assignment is never rebuilt", async () => {
		cage.append(makeLeaf(0));
		document.body.appendChild(cage);
		await flush();

		const slot = cage.shadowRoot?.querySelector("slot");
		expect(slot?.assignedElements().length).toBe(1);

		await cage.update();
		expect(cage.shadowRoot?.querySelector("slot")).toBe(slot);
		expect(slot?.assignedElements().length).toBe(1);
	});

	test("re-rendering re-measures rather than reusing the previous box", async () => {
		const leaf = makeLeaf(0);
		cage.append(leaf);
		document.body.appendChild(cage);
		await flush();
		expect(boxVariable("--center-x")).toBe("0px");

		leaf.style.transform = "translate3d(360px, 0px, 0px)";
		await cage.update();
		expect(boxVariable("--center-x")).toBe("360px");
	});

	test("the carrier transform still rides its own props", async () => {
		cage.setAttribute("position", "1 0 0");
		document.body.appendChild(cage);
		await flush();

		expect(boxVariable("--block-x")).toBe("120px");
	});
});
