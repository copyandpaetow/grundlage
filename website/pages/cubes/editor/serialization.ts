import { formatNumber, isBlock, resolveBlockTransform } from "../scene-shared";
import { readPosition, readRotation } from "./transforms";

// Serialize the live scene to portable markup: skip editor-only overlays
// (gizmo/ghost are not selectable, so they fall away), recurse into groups, and
// normalize each block's shorthand-vs-specific attributes to one concrete triple
// so a reader never implements precedence. Round-trips back into an equal scene.
const serializeBlock = (
	block: Element,
	depth: number,
	lines: string[],
): void => {
	const indent = "\t".repeat(depth);
	const tag = block.tagName.toLowerCase();
	const isGroup = tag === "scene-group";

	const attributes: string[] = [];
	const position = readPosition(block);
	const rotation = readRotation(block);
	if (position.some((value) => value !== 0)) {
		attributes.push(`position="${position.map(formatNumber).join(" ")}"`);
	}
	if (rotation.some((value) => value !== 0)) {
		attributes.push(`rotation="${rotation.map(formatNumber).join(" ")}"`);
	}
	if (!isGroup) {
		const size = resolveBlockTransform(block).size;
		if (size.some((value) => value !== 1)) {
			attributes.push(`size="${size.map(formatNumber).join(" ")}"`);
		}
	}
	const suffix = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";

	// A selected block sits inside a gizmo; serialize the real geometry, not the
	// wrapper, by recursing through children for groups only.
	const childBlocks = Array.from(block.children).filter(isBlock);
	if (isGroup && childBlocks.length > 0) {
		lines.push(`${indent}<${tag}${suffix}>`);
		for (const child of childBlocks) serializeBlock(child, depth + 1, lines);
		lines.push(`${indent}</${tag}>`);
	} else {
		lines.push(`${indent}<${tag}${suffix}></${tag}>`);
	}
};

export const exportScene = (host: HTMLElement): void => {
	const lines: string[] = ["<scene-world>"];
	// Selected blocks sit inside a scene-select inside a gizmo, so reach through both
	// wrappers. The placement ghost is a transient preview and is deliberately skipped.
	const walk = (parent: Element): void => {
		for (const child of Array.from(parent.children)) {
			if (isBlock(child)) serializeBlock(child, 1, lines);
			else if (
				child.tagName.toLowerCase() === "scene-gizmo" ||
				child.tagName.toLowerCase() === "scene-select"
			)
				walk(child);
		}
	};
	walk(host);
	lines.push("</scene-world>");
	const markup = lines.join("\n");

	console.log(markup);
	void navigator.clipboard?.writeText(markup).catch(() => {});
};
