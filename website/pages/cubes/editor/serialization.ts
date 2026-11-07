import { blockTransformFromAttributes, formatNumber } from "../scene-shared";
import { isBlock } from "../scene-geometry";

// Shorthand and per-axis attributes collapse into one triple, so a reader never resolves
// precedence

// A selected block sits inside scene-gizmo > scene-select, at any depth; the placement
// ghost is a transient preview and stays out.
const childBlocksOf = (parent: Element): Element[] =>
	Array.from(parent.children).flatMap((child) => {
		if (isBlock(child)) return [child];
		const tag = child.tagName.toLowerCase();
		return tag === "scene-gizmo" || tag === "scene-select" ? childBlocksOf(child) : [];
	});

const serializeBlock = (block: Element, depth: number, lines: string[]): void => {
	const indent = "\t".repeat(depth);
	const tag = block.tagName.toLowerCase();
	const isGroup = tag === "scene-group";
	const { position, rotation, size } = blockTransformFromAttributes(block);

	const attributes: string[] = [];
	if (position.some((value) => value !== 0)) {
		attributes.push(`position="${position.map(formatNumber).join(" ")}"`);
	}
	if (rotation.some((value) => value !== 0)) {
		attributes.push(`rotation="${rotation.map(formatNumber).join(" ")}"`);
	}
	if (!isGroup && size.some((value) => value !== 1)) {
		attributes.push(`size="${size.map(formatNumber).join(" ")}"`);
	}
	const suffix = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";

	const childBlocks = childBlocksOf(block);
	if (childBlocks.length > 0) {
		lines.push(`${indent}<${tag}${suffix}>`);
		for (const child of childBlocks) serializeBlock(child, depth + 1, lines);
		lines.push(`${indent}</${tag}>`);
	} else {
		lines.push(`${indent}<${tag}${suffix}></${tag}>`);
	}
};

export const exportScene = (world: HTMLElement): void => {
	const lines: string[] = ["<scene-world>"];
	for (const block of childBlocksOf(world)) serializeBlock(block, 1, lines);
	lines.push("</scene-world>");
	const markup = lines.join("\n");

	console.log(markup);
	void navigator.clipboard?.writeText(markup).catch(() => {});
};
