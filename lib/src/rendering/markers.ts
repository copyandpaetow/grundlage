import * as MARKUP from "../parser/markup";
import * as CHARACTER_CODE from "../parser/character-code";
import { DYNAMIC_TAG_PLACEHOLDER } from "../parser/constants";
import * as OPEN_CONSTRUCT from "../parser/open-construct";
import {
	assertDuringDevelopment,
	libraryMessage,
	warnDuringDevelopment,
} from "../utils/diagnostics";

const MARKER_PREFIX = MARKUP.COMMENT_IDENTIFIER + " ";
const CLOSE_SLASH_INDEX = MARKER_PREFIX.length;
const TAG_OPEN_MARKER_PREFIX = MARKER_PREFIX + OPEN_CONSTRUCT.TAG + "-";

const isOpenMarkerData = (data: string) =>
	data.startsWith(MARKER_PREFIX) &&
	data.charCodeAt(CLOSE_SLASH_INDEX) !== CHARACTER_CODE.SLASH;

//the HTML parser relocates an element its content model forbids (a <tr> inside <table> is moved
//in front of the table) and reads markers inside <![CDATA[…]]> as text
export const ensureFragmentKeptEveryBinding = (
	fragment: DocumentFragment,
	expectedOpenMarkerCount: number,
): void => {
	const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
	let openMarkerCount = 0;
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (isOpenMarkerData(node.data)) openMarkerCount++;
		if (!node.data.startsWith(TAG_OPEN_MARKER_PREFIX)) continue;
		const placeholderStayedAfterMarker =
			node.nextElementSibling?.localName === DYNAMIC_TAG_PLACEHOLDER;
		if (placeholderStayedAfterMarker) continue;
		const parentName = node.parentElement?.localName ?? "the template root";
		throw new Error(
			libraryMessage(
				`a dynamic tag <\${…}> inside <${parentName}> was moved by the HTML parser, which only allows specific elements there (a <tr> in a <table>, an <option> in a <select>). Write that tag statically.`,
			),
		);
	}
	if (openMarkerCount !== expectedOpenMarkerCount)
		throw new Error(
			libraryMessage(
				"a ${…} hole sits where the HTML parser reads markup as plain text, such as inside <![CDATA[…]]>. Move the hole outside of it.",
			),
		);
};

//a binding's open marker sits directly before the element it binds
export const elementAfterMarker = (openMarker: Comment): Element => {
	const element = openMarker.nextElementSibling;
	assertDuringDevelopment(
		element !== null,
		"an attribute or tag marker sits right before its element",
	);
	return element;
};

//every walk stops at the range it may consume, so a contradicting server range is rejected rather
//than adopting a later binding's markers. A null bound means the walker's own root bounds it
export const scanToClose = (
	walker: TreeWalker,
	openMarker: Comment,
	closeMarkerData: string,
	rangeEnd: Comment | null,
): Comment | null => {
	const openMarkerData = openMarker.data;
	let depth = 1;
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node === rangeEnd) return null;
		if (node.data === openMarkerData) depth++;
		else if (node.data === closeMarkerData && --depth === 0) return node;
	}
	return null;
};

export const nextOpenMarker = (
	walker: TreeWalker,
	rangeEnd: Comment | null,
): Comment | null => {
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node === rangeEnd) return null;
		if (isOpenMarkerData(node.data)) return node;
	}
	return null;
};

export const NO_LIST_TAIL: unique symbol = Symbol("no list tail");

export const nextListTail = (
	walker: TreeWalker,
	rangeEnd: Comment,
): Comment | typeof NO_LIST_TAIL => {
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node === rangeEnd) return NO_LIST_TAIL;
		if (node.data === MARKUP.LIST_MARKER_DATA) return node;
	}
	return NO_LIST_TAIL;
};

export const warnOnRejectedServerRange = (): void =>
	warnDuringDevelopment(
		"hydration mismatch: the server's markup does not match this template. Yield the same first template on the server and the client.",
	);

export const clearRange = (
	first: ChildNode | null,
	end: ChildNode | null,
): void => {
	let current = first;
	while (current && current !== end) {
		const next = current.nextSibling;
		current.remove();
		current = next;
	}
};
