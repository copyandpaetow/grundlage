import { afterEach, describe, expect, test } from "vitest";
import "./scene-cube";

//Real Chromium, because the size lives in registered custom properties: happy-dom
//ignores the registration, so a scale that never reaches the faces passes there.
//No perspective is set, so a front face measures its true width on screen.

const created: HTMLElement[] = [];

const mountCube = (attributes: Record<string, string>): HTMLElement => {
	const cube = document.createElement("scene-cube");
	for (const [name, value] of Object.entries(attributes)) cube.setAttribute(name, value);
	document.body.appendChild(cube);
	created.push(cube);
	return cube;
};

const frontFace = (cube: HTMLElement): DOMRect =>
	cube.shadowRoot!.querySelector(".front")!.getBoundingClientRect();

afterEach(() => {
	for (const element of created) element.remove();
	created.length = 0;
});

describe("scene-cube size", () => {
	test("a size of 2 paints faces twice as wide as a size of 1", () => {
		const unitCube = mountCube({});
		const doubleCube = mountCube({ size: "2" });
		expect(frontFace(doubleCube).width).toBeCloseTo(frontFace(unitCube).width * 2, 1);
	});

	test("a nested cube keeps the world grid inside a sized parent", () => {
		const parent = mountCube({ size: "2" });
		const child = document.createElement("scene-cube");
		child.setAttribute("position", "0 2 0");
		parent.appendChild(child);
		const unitWidth = frontFace(mountCube({})).width;

		const parentFace = frontFace(parent);
		const childFace = frontFace(child);
		expect(childFace.width).toBeCloseTo(unitWidth, 1);
		const parentCenterY = parentFace.y + parentFace.height / 2;
		const childCenterY = childFace.y + childFace.height / 2;
		expect(parentCenterY - childCenterY).toBeCloseTo(unitWidth * 2, 1);
	});
});
