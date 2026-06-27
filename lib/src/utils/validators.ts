import { HTMLTemplate } from "../rendering/template-html";

export const isComment = (node: Node): node is Comment =>
	node.nodeType === Node.COMMENT_NODE;

export const isSameTemplate = (a: HTMLTemplate, b: HTMLTemplate) =>
	a.parsedHTML === b.parsedHTML;

export const isPlainObject = (
	entry: unknown,
): entry is Record<string, unknown> => entry?.constructor === Object;
