import { HTMLTemplate } from "../rendering/template-html";

export const isComment = (node: Node): node is Comment =>
	node.nodeType === Node.COMMENT_NODE;

export const isSameTemplate = (a: HTMLTemplate, b: HTMLTemplate) =>
	a.parsedHTML.templateHash === b.parsedHTML.templateHash;

export const isObject = (entry: unknown): entry is Object =>
	entry?.constructor === Object;
