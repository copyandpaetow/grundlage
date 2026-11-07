import * as MARKUP from "../parser/markup";
import * as CHARACTER_CODE from "../parser/character-code";
import { DYNAMIC_TAG_PLACEHOLDER } from "../parser/constants";
import * as OPEN_CONSTRUCT from "../parser/open-construct";
import * as BINDING from "../parser/binding";
import { ParsedTemplate } from "../parser/types";
import {
	assertDuringDevelopment,
	libraryMessage,
	warnDuringDevelopment,
} from "../utils/diagnostics";

const MARKER_PREFIX = MARKUP.COMMENT_IDENTIFIER + " ";
const CLOSE_SLASH_INDEX = MARKER_PREFIX.length;
const TAG_OPEN_MARKER_PREFIX = MARKER_PREFIX + OPEN_CONSTRUCT.TAG + "-";
const ATTRIBUTE_OPEN_MARKER_PREFIX =
	MARKER_PREFIX + OPEN_CONSTRUCT.ATTRIBUTE + "-";
const RAW_CONTENT_OPEN_MARKER_PREFIX =
	MARKER_PREFIX + OPEN_CONSTRUCT.RAW_CONTENT + "-";

const isElementMarkerData = (data: string) =>
	data.startsWith(TAG_OPEN_MARKER_PREFIX) ||
	data.startsWith(ATTRIBUTE_OPEN_MARKER_PREFIX) ||
	data.startsWith(RAW_CONTENT_OPEN_MARKER_PREFIX);

//an element's markers (tag, attributes, raw content) run unbroken up to the element itself
const elementAfterMarkerRun = (marker: Comment): Element | null => {
	let sibling = marker.nextSibling;
	while (sibling instanceof Comment && isElementMarkerData(sibling.data))
		sibling = sibling.nextSibling;
	return sibling instanceof Element ? sibling : null;
};

const isOpenMarkerData = (data: string) =>
	data.startsWith(MARKER_PREFIX) &&
	data.charCodeAt(CLOSE_SLASH_INDEX) !== CHARACTER_CODE.SLASH;

//the HTML parser copies an open formatting element past a block it does not close (a <div> inside
//<p><b>) and past a misnested end tag, attributes included, but a binding only reaches the original
const FORMATTING_TAGS = new Set([
	"a",
	"b",
	"big",
	"code",
	"em",
	"font",
	"i",
	"nobr",
	"s",
	"small",
	"strike",
	"strong",
	"tt",
	"u",
]);

//markup inside raw text counts too, which can only hide a copy, never invent one
const writtenStartTagCountOf = (markup: string, tagName: string) =>
	markup.match(new RegExp(`<${tagName}[\\s/>]`, "gi"))?.length ?? 0;

const bindingIndexOfMarker = (data: string) =>
	Number(data.slice(data.indexOf("-") + 1));

//the HTML parser relocates an element its content model forbids (a <tr> inside <table> moves in
//front of it, a <div> closes the <p> around it) and reads markers inside <![CDATA[…]]> as text
export const ensureFragmentKeptEveryBinding = (
	fragment: DocumentFragment,
	parsed: ParsedTemplate,
): void => {
	const expectedOpenMarkerCount =
		parsed.bindings.length - parsed.hostBindingCount;
	const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
	let openMarkerCount = 0;
	let lastBindingIndex = -1;
	const boundFormattingTags = new Set<string>();
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (!isOpenMarkerData(node.data)) continue;
		openMarkerCount++;
		const parentName = node.parentElement?.localName ?? "the template root";
		//markers are numbered in source order, so one that arrives early was moved there
		const bindingIndex = bindingIndexOfMarker(node.data);
		if (bindingIndex < lastBindingIndex)
			throw new Error(
				libraryMessage(
					`the HTML parser moved a bound node ahead of one inside <${parentName}>, as it moves a <p> or <div> out of a <table>. Fix the nesting.`,
				),
			);
		lastBindingIndex = bindingIndex;
		const binding = parsed.bindings[bindingIndex];
		if (binding.type === BINDING.TAG) {
			if (elementAfterMarkerRun(node)?.localName === DYNAMIC_TAG_PLACEHOLDER)
				continue;
			throw new Error(
				libraryMessage(
					`a dynamic tag <\${…}> inside <${parentName}> was moved by the HTML parser, which only allows specific elements there (a <tr> in a <table>, an <option> in a <select>). Write that tag statically.`,
				),
			);
		}
		const bindsElement =
			binding.type === BINDING.ATTRIBUTE ||
			binding.type === BINDING.DYNAMIC_ATTRIBUTE ||
			binding.type === BINDING.RAW_CONTENT ||
			binding.type === BINDING.TEMPLATE_CONTENT;
		if (!bindsElement) continue;
		const element = elementAfterMarkerRun(node);
		const isBoundElement =
			element !== null &&
			element.localName.toLowerCase() === binding.elementName.toLowerCase();
		if (isBoundElement) {
			if (FORMATTING_TAGS.has(element.localName))
				boundFormattingTags.add(element.localName);
			continue;
		}
		throw new Error(
			libraryMessage(
				`a bound element inside <${parentName}> was moved by the HTML parser, which closes or relocates an element its parent cannot hold (a <div> in a <p>, a <textarea> in a <table>, a <tbody> around a bare <tr>). Fix the nesting.`,
			),
		);
	}
	for (const tagName of boundFormattingTags) {
		const builtCount = fragment.querySelectorAll(tagName).length;
		if (builtCount > writtenStartTagCountOf(parsed.htmlWithMarkers, tagName))
			throw new Error(
				libraryMessage(
					`a bound <${tagName}> is copied by the HTML parser past a block it does not close (a <div> inside <p><${tagName}>) or a misnested end tag, and the copies never get the bound value. Fix the nesting.`,
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

const isMarkerData = (data: string): boolean =>
	data.startsWith(MARKER_PREFIX) || data === MARKUP.LIST_MARKER_DATA;

//the instance bound to this fragment can no longer patch it
export const removeMarkers = (fragment: DocumentFragment): void => {
	const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
	const markers: Array<Comment> = [];
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null))
		if (isMarkerData(node.data)) markers.push(node);
	for (let index = 0; index < markers.length; index++) markers[index].remove();
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
