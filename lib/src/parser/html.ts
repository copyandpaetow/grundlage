import { stringListHash } from "../utils/hashing";
import { DYNAMIC_TAG_PLACEHOLDER, NO_KEY, STYLE_SHEET_NOT_COMPILED } from "./constants";
import * as BINDING from "./binding";
import * as OPEN_CONSTRUCT from "./open-construct";
import { ParsedTemplate, Part, StaticBinding } from "./types";
import { isLetterCode, isQuoteCode, isWhitespaceCode } from "./characters";
import * as MARKUP from "./markup";
import * as CHARACTER_CODE from "./character-code";
import { compileStyleSheet } from "./css";
import { decodeRCDATAParts, dropLeadingLineFeed } from "./rcdata";
import { ValueOf } from "../utils/types";
import {
	assertDuringDevelopment,
	libraryMessage,
	warnDuringDevelopment,
} from "../utils/diagnostics";
import * as PARSE_MODE from "./parse-mode";
import * as ROOT_TEMPLATE from "./root-template";

//the strings are joined with a reserved character, so no construct is ever cut by a hole and each
//reader runs from its opener to its end

//a private-use character: markup has no reason to contain one, so a written one throws
const HOLE = "";
const HOLE_CODE = HOLE.charCodeAt(0);

const TEMPLATE_TAG = "template";
const TEXTAREA_TAG = "textarea";
const TITLE_TAG = "title";
const SELECT_TAG = "select";
const PLAINTEXT_TAG = "plaintext";
const SHADOW_ROOT_MODE_ATTRIBUTE = "shadowrootmode";
//<noscript> too: a page parses with scripting on, which reads its content as text
const UNESCAPED_TEXT_TAGS = new Set([
	"noscript",
	"xmp",
	"iframe",
	"noembed",
	"noframes",
	PLAINTEXT_TAG,
]);
//elements without content or end tag: `</br>` even reads as a second <br>
const VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
]);
const CHARACTER_DATA_OPEN = "<![CDATA[";
const CHARACTER_DATA_CLOSE = "]]>";

type OpenConstructKind = ValueOf<typeof OPEN_CONSTRUCT>;
type ParseModeKind = ValueOf<typeof PARSE_MODE>;
type RootTemplateKind = ValueOf<typeof ROOT_TEMPLATE>;

interface TemplateReader {
	source: string;
	index: number;
	readHoleCount: number;
	//holes are read in source order, so the next one is found once instead of from every construct
	nextHoleIndex: number;
	resultMarkup: string;
	bindings: Array<StaticBinding>;
	startedBindingCount: number;
	hostBindingCount: number;
	keyValueParts: Array<Part> | typeof NO_KEY;
	hasStyleSheetBinding: boolean;
	rootTemplate: RootTemplateKind;
	hasSeenTopLevelSibling: boolean;
	//one entry per open element, innermost last: whether its tag name holds a hole
	openTagIsDynamic: Array<boolean>;
	isTemplateContent: boolean;
}

//the end of the source stands for "no hole left": every range ends at or before it
const holeIndexFrom = (source: string, start: number) => {
	const holeIndex = source.indexOf(HOLE, start);
	return holeIndex === -1 ? source.length : holeIndex;
};

const createTemplateReader = (
	strings: TemplateStringsArray,
	mode: ParseModeKind,
): TemplateReader => {
	for (const text of strings) {
		if (text.includes(HOLE)) {
			throw new Error(
				libraryMessage(
					"the template contains U+E000, which the parser reserves for holes. Write it as &#xE000;.",
				),
			);
		}
	}
	const source = strings.join(HOLE);
	return {
		source,
		index: 0,
		readHoleCount: 0,
		nextHoleIndex: holeIndexFrom(source, 0),
		resultMarkup: "",
		bindings: [],
		startedBindingCount: 0,
		hostBindingCount: 0,
		keyValueParts: NO_KEY,
		hasStyleSheetBinding: false,
		rootTemplate:
			mode === PARSE_MODE.NO_ROOT_TEMPLATE ? ROOT_TEMPLATE.RULED_OUT : ROOT_TEMPLATE.UNDECIDED,
		hasSeenTopLevelSibling: false,
		openTagIsDynamic: [],
		isTemplateContent: false,
	};
};

const unclosedError = (construct: string) =>
	new Error(libraryMessage(`${construct} is never closed. Close it.`));

//every hole passes through here exactly once and in order, which is what numbers it
const partsOfRange = (reader: TemplateReader, start: number, end: number): Array<Part> => {
	assertDuringDevelopment(
		reader.nextHoleIndex >= start,
		"ranges are read in source order, so no hole before this range is left unread",
	);
	const parts: Array<Part> = [];
	let sliceStart = start;
	while (reader.nextHoleIndex < end) {
		if (reader.nextHoleIndex > sliceStart) {
			parts.push(reader.source.slice(sliceStart, reader.nextHoleIndex));
		}
		parts.push(reader.readHoleCount++);
		sliceStart = reader.nextHoleIndex + 1;
		reader.nextHoleIndex = holeIndexFrom(reader.source, sliceStart);
	}
	if (end > sliceStart) parts.push(reader.source.slice(sliceStart, end));
	return parts;
};

const hasHole = (parts: ReadonlyArray<Part>) => parts.some((part) => typeof part === "number");

const asComment = (markerData: string) =>
	`${MARKUP.COMMENT_OPEN}${markerData}${MARKUP.COMMENT_CLOSE}`;

const openMarkerComment = (openConstructKind: OpenConstructKind, bindingIndex: number) =>
	asComment(`${MARKUP.COMMENT_IDENTIFIER} ${openConstructKind}-${bindingIndex}`);

const isTopLevel = (reader: TemplateReader) => reader.openTagIsDynamic.length === 0;

const parsesContentAsRaw = (tagName: string) => {
	return (
		tagName === MARKUP.STYLE_TAG ||
		tagName === TEXTAREA_TAG ||
		tagName === TITLE_TAG ||
		tagName === MARKUP.SCRIPT_TAG
	);
};

const rootTemplateAfterOpenTag = (reader: TemplateReader, tagName: string): RootTemplateKind => {
	switch (reader.rootTemplate) {
		case ROOT_TEMPLATE.UNDECIDED: {
			const isRootTemplate = tagName === TEMPLATE_TAG && !reader.hasSeenTopLevelSibling;
			return isRootTemplate ? ROOT_TEMPLATE.IS_THE_CURRENT_TAG : ROOT_TEMPLATE.RULED_OUT;
		}
		case ROOT_TEMPLATE.IS_THE_CURRENT_TAG:
			return ROOT_TEMPLATE.CONTENT_OPEN;
		case ROOT_TEMPLATE.RULED_OUT:
		case ROOT_TEMPLATE.CONTENT_OPEN:
		case ROOT_TEMPLATE.CLOSED:
			return reader.rootTemplate;
		default:
			return reader.rootTemplate satisfies never;
	}
};

const hasNonWhitespace = (text: string) => {
	for (let index = 0; index < text.length; index++) {
		if (!isWhitespaceCode(text.charCodeAt(index))) return true;
	}
	return false;
};

const readText = (reader: TemplateReader, end: number) => {
	const { source } = reader;
	for (const part of partsOfRange(reader, reader.index, end)) {
		if (typeof part === "string") {
			reader.resultMarkup += part;
			const isTopLevelText = isTopLevel(reader) && hasNonWhitespace(part);
			if (isTopLevelText) reader.hasSeenTopLevelSibling = true;
			continue;
		}
		const bindingIndex = reader.startedBindingCount++;
		const closeMarkerData = `${MARKUP.COMMENT_IDENTIFIER} /${OPEN_CONSTRUCT.CONTENT}-${bindingIndex}`;
		reader.resultMarkup +=
			openMarkerComment(OPEN_CONSTRUCT.CONTENT, bindingIndex) + asComment(closeMarkerData);
		reader.bindings.push({
			type: BINDING.CONTENT,
			valueIndex: part,
			closeMarkerData,
		});
		if (isTopLevel(reader)) reader.hasSeenTopLevelSibling = true;
	}
	reader.index = end;
	assertDuringDevelopment(
		source.charCodeAt(end) !== HOLE_CODE,
		"text ends on a tag opener or the end of the template, never on a hole",
	);
};

//the close is searched from the opener's dashes, so `<!-->` closes itself
const readComment = (reader: TemplateReader) => {
	if (!reader.source.startsWith(MARKUP.COMMENT_OPEN, reader.index)) {
		throw new Error(
			libraryMessage(
				"a `<!` opens neither a comment nor <![CDATA[. Write a comment as <!-- … -->, or a literal `<` as &lt;.",
			),
		);
	}
	const contentStart = reader.index + MARKUP.COMMENT_OPEN.length;
	const commentClose = reader.source.indexOf(MARKUP.COMMENT_CLOSE, reader.index + "<!".length);
	if (commentClose === -1) throw unclosedError("a comment");
	const parts = partsOfRange(reader, contentStart, Math.max(contentStart, commentClose));
	reader.index = commentClose + MARKUP.COMMENT_CLOSE.length;

	if (!hasHole(parts)) {
		reader.resultMarkup += asComment(parts.join(""));
		return;
	}
	//the first dynamic comment is the list key: it never reaches the DOM and owns no binding index
	const isListKey = reader.keyValueParts === NO_KEY && !reader.isTemplateContent;
	if (isListKey) {
		reader.keyValueParts = parts;
		return;
	}
	reader.resultMarkup +=
		openMarkerComment(OPEN_CONSTRUCT.COMMENT, reader.startedBindingCount++) + MARKUP.EMPTY_COMMENT;
	reader.bindings.push({ type: BINDING.COMMENT, parts });
};

//foreign content only; the HTML parser reads what is inside as text, so a marker there never binds
const readCharacterData = (reader: TemplateReader) => {
	const contentStart = reader.index + CHARACTER_DATA_OPEN.length;
	const characterDataClose = reader.source.indexOf(CHARACTER_DATA_CLOSE, contentStart);
	if (characterDataClose === -1) throw unclosedError("a <![CDATA[ section");
	const parts = partsOfRange(reader, contentStart, characterDataClose);
	if (hasHole(parts)) {
		throw new Error(
			libraryMessage(
				"a ${…} hole sits where the HTML parser reads markup as plain text, such as inside <![CDATA[…]]>. Move the hole outside of it.",
			),
		);
	}
	reader.index = characterDataClose + CHARACTER_DATA_CLOSE.length;
	reader.resultMarkup += reader.source.slice(
		contentStart - CHARACTER_DATA_OPEN.length,
		reader.index,
	);
};

const readEndTag = (reader: TemplateReader) => {
	const nameStart = reader.index + MARKUP.END_TAG_OPEN.length;
	const tagClose = reader.source.indexOf(MARKUP.TAG_CLOSE, nameStart);
	if (tagClose === -1) throw unclosedError("an end tag");
	const parts = partsOfRange(reader, nameStart, tagClose);
	reader.index = tagClose + MARKUP.TAG_CLOSE.length;

	const isDynamicClose = hasHole(parts);
	const openerIsDynamic = reader.openTagIsDynamic[reader.openTagIsDynamic.length - 1];
	if (isDynamicClose && !openerIsDynamic) {
		throw new Error(
			libraryMessage(
				"asymmetric tag: a dynamic </${...}> close has no matching dynamic open tag. Pair `<${tag}>` with `</${tag}>`.",
			),
		);
	}
	reader.openTagIsDynamic.pop();

	const rootTemplateIsOpen =
		reader.rootTemplate === ROOT_TEMPLATE.IS_THE_CURRENT_TAG ||
		reader.rootTemplate === ROOT_TEMPLATE.CONTENT_OPEN;
	if (rootTemplateIsOpen && isTopLevel(reader)) {
		reader.rootTemplate = ROOT_TEMPLATE.CLOSED;
		return;
	}
	if (!isDynamicClose && openerIsDynamic) {
		throw new Error(
			libraryMessage(
				"asymmetric tag: a static end tag cannot pair with a dynamic <${...}> open tag. Make the close dynamic too.",
			),
		);
	}
	const tagName = isDynamicClose ? DYNAMIC_TAG_PLACEHOLDER : parts.join("");
	reader.resultMarkup += MARKUP.END_TAG_OPEN + tagName + MARKUP.TAG_CLOSE;
};

const startsSelfClosingEnd = (source: string, index: number) =>
	source.charCodeAt(index) === CHARACTER_CODE.SLASH &&
	source.charCodeAt(index + 1) === CHARACTER_CODE.GREATER_THAN;

const endsTagName = (source: string, index: number) => {
	const code = source.charCodeAt(index);
	return (
		code === CHARACTER_CODE.GREATER_THAN ||
		isWhitespaceCode(code) ||
		startsSelfClosingEnd(source, index)
	);
};

const endsAttributeName = (source: string, index: number) => {
	const code = source.charCodeAt(index);
	return (
		code === CHARACTER_CODE.EQUALS ||
		code === CHARACTER_CODE.GREATER_THAN ||
		isWhitespaceCode(code) ||
		startsSelfClosingEnd(source, index)
	);
};

//HTML reads the slash of `width=2/>` into the value; SVG markup means the self-closing end
const endsUnquotedValue = (source: string, index: number) => {
	const code = source.charCodeAt(index);
	return (
		code === CHARACTER_CODE.GREATER_THAN ||
		isWhitespaceCode(code) ||
		startsSelfClosingEnd(source, index)
	);
};

const findEnd = (
	source: string,
	start: number,
	isEnd: (source: string, index: number) => boolean,
): number => {
	let end = start;
	while (end < source.length && !isEnd(source, end)) end++;
	return end;
};

//<select> has no value attribute, and its options are not there yet when its own bindings commit
const warnOnSelectValueBinding = (tagName: string, binding: StaticBinding): void => {
	if (tagName !== SELECT_TAG) return;
	if (binding.type !== BINDING.ATTRIBUTE) return;
	const [name] = binding.nameParts;
	const isValueName =
		binding.nameParts.length === 1 && typeof name === "string" && name.toLowerCase() === "value";
	if (isValueName) {
		warnDuringDevelopment(
			"`<select value=${…}>` selects nothing: <select> has no value attribute. Bind `selected` on the option instead: `<option selected=${…}>`.",
		);
	}
};

const attributeBindingOf = (
	elementName: string,
	nameParts: Array<Part>,
	valueParts: Array<Part>,
): StaticBinding => {
	const isExpandableSpread =
		valueParts.length === 0 && nameParts.length === 1 && typeof nameParts[0] === "number";
	if (isExpandableSpread) {
		return {
			type: BINDING.DYNAMIC_ATTRIBUTE,
			elementName,
			valueIndex: nameParts[0] as number,
		};
	}
	return {
		type: BINDING.ATTRIBUTE,
		elementName,
		nameParts,
		valueParts: valueParts.length > 0 ? valueParts : [""],
	};
};

const ensureNoShadowRootMode = (nameParts: ReadonlyArray<Part>) => {
	const [name] = nameParts;
	const isShadowRootMode =
		nameParts.length === 1 &&
		typeof name === "string" &&
		name.toLowerCase() === SHADOW_ROOT_MODE_ATTRIBUTE;
	if (!isShadowRootMode) return;
	throw new Error(
		libraryMessage(
			"a nested <template> expects no shadowrootmode: a paint keeps it a plain <template>, while the browser turns it into a shadow root in server markup, so the two disagree. Let the element attach its own shadow root.",
		),
	);
};

const readAttributeValue = (reader: TemplateReader): Array<Part> => {
	const { source } = reader;
	if (source.charCodeAt(reader.index) !== CHARACTER_CODE.EQUALS) return [];
	const valueStart = reader.index + 1;
	const quoteCode = source.charCodeAt(valueStart);
	if (!isQuoteCode(quoteCode)) {
		const valueEnd = findEnd(source, valueStart, endsUnquotedValue);
		const valueParts = partsOfRange(reader, valueStart, valueEnd);
		reader.index = valueEnd;
		return valueParts;
	}
	//nothing between the quotes can end the value, holes included, so the scan is a search
	const closingQuote = source.indexOf(String.fromCharCode(quoteCode), valueStart + 1);
	if (closingQuote === -1) throw unclosedError("an attribute value");
	const valueParts = partsOfRange(reader, valueStart + 1, closingQuote);
	reader.index = closingQuote + 1;
	if (source.charCodeAt(reader.index) === HOLE_CODE) {
		throw new Error(
			libraryMessage(
				'a ${…} right after a quoted attribute value belongs to no attribute. Put a space before it: a="1" ${…}',
			),
		);
	}
	return valueParts;
};

//reads up to just past the `>` or `/>`; static attributes come back as markup, bound ones as markers
const readAttributes = (
	reader: TemplateReader,
	tagName: string,
): {
	attributeMarkup: string;
	markerMarkup: string;
	isSelfClosing: boolean;
} => {
	const { source } = reader;
	const isOnRootTemplate = reader.rootTemplate === ROOT_TEMPLATE.IS_THE_CURRENT_TAG;
	const isNestedTemplate = tagName === TEMPLATE_TAG && !isOnRootTemplate;
	let attributeMarkup = "";
	let markerMarkup = "";

	while (reader.index < source.length) {
		while (isWhitespaceCode(source.charCodeAt(reader.index))) reader.index++;

		if (source.charCodeAt(reader.index) === CHARACTER_CODE.GREATER_THAN) {
			reader.index++;
			return { attributeMarkup, markerMarkup, isSelfClosing: false };
		}
		if (startsSelfClosingEnd(source, reader.index)) {
			reader.index += 2;
			return { attributeMarkup, markerMarkup, isSelfClosing: true };
		}
		if (reader.index >= source.length) break;

		const nameStart = reader.index;
		const nameEnd = findEnd(source, nameStart + 1, endsAttributeName);
		const nameParts = partsOfRange(reader, nameStart, nameEnd);
		reader.index = nameEnd;
		if (isNestedTemplate) ensureNoShadowRootMode(nameParts);
		const valueParts = readAttributeValue(reader);

		//the root template's tag is not written, so its static attributes become host bindings
		const isBinding = isOnRootTemplate || hasHole(nameParts) || hasHole(valueParts);
		if (isBinding) {
			const bindingIndex = reader.startedBindingCount++;
			const binding = attributeBindingOf(tagName, nameParts, valueParts);
			warnOnSelectValueBinding(tagName, binding);
			reader.bindings.push(binding);
			if (isOnRootTemplate) reader.hostBindingCount++;
			else markerMarkup += openMarkerComment(OPEN_CONSTRUCT.ATTRIBUTE, bindingIndex);
			continue;
		}
		attributeMarkup += MARKUP.ATTRIBUTE_SEPARATOR + nameParts.join("");
		if (valueParts.length > 0) {
			attributeMarkup +=
				MARKUP.ATTRIBUTE_ASSIGN +
				MARKUP.ATTRIBUTE_QUOTE +
				valueParts.join("") +
				MARKUP.ATTRIBUTE_QUOTE;
		}
	}
	throw unclosedError("an open tag");
};

//raw content ends at the first `</` followed by its own tag name
const readRawContent = (
	reader: TemplateReader,
	tagName: string,
): { contentMarkup: string; markerMarkup: string } => {
	let closeTagStart = reader.source.indexOf(MARKUP.END_TAG_OPEN, reader.index);
	while (
		closeTagStart !== -1 &&
		!reader.source.startsWith(tagName, closeTagStart + MARKUP.END_TAG_OPEN.length)
	) {
		closeTagStart = reader.source.indexOf(MARKUP.END_TAG_OPEN, closeTagStart + 1);
	}
	if (closeTagStart === -1) throw unclosedError(`<${tagName}>`);
	const parts = partsOfRange(reader, reader.index, closeTagStart);
	reader.index = closeTagStart;

	if (!hasHole(parts)) return { contentMarkup: parts.join(""), markerMarkup: "" };
	if (tagName === TEXTAREA_TAG || tagName === TITLE_TAG) decodeRCDATAParts(parts, tagName);
	if (tagName === TEXTAREA_TAG) dropLeadingLineFeed(parts);
	//the sheet text is composed with literal values at first commit, while the clone is
	//still detached — the cached markup deliberately carries an empty <style>
	const compiledStyleSheet =
		tagName === MARKUP.STYLE_TAG ? compileStyleSheet(parts) : STYLE_SHEET_NOT_COMPILED;
	if (compiledStyleSheet !== STYLE_SHEET_NOT_COMPILED) reader.hasStyleSheetBinding = true;
	const bindingIndex = reader.startedBindingCount++;
	reader.bindings.push({
		type: BINDING.RAW_CONTENT,
		elementName: tagName,
		parts,
		compiledStyleSheet,
	});
	return {
		contentMarkup: "",
		markerMarkup: openMarkerComment(OPEN_CONSTRUCT.RAW_CONTENT, bindingIndex),
	};
};

const textEndOf = (source: string, start: number, lowercaseName: string) => {
	if (lowercaseName === PLAINTEXT_TAG) return source.length;
	const endTag = new RegExp(`</${lowercaseName}[\\t\\n\\f\\r />]`, "gi");
	endTag.lastIndex = start;
	return endTag.exec(source)?.index ?? source.length;
};

const ensureStaticContent = (reader: TemplateReader, tagName: string) => {
	const end = textEndOf(reader.source, reader.index, tagName.toLowerCase());
	if (reader.nextHoleIndex >= end) return;
	throw new Error(
		libraryMessage(
			`<${tagName}> expects no \${…} in its content, which a page's HTML parser reads as text and a serializer writes unescaped. Move the hole out of <${tagName}>.`,
		),
	);
};

//every marker of an element goes in front of it: tag, then attributes, then raw content
const readElement = (reader: TemplateReader) => {
	const nameStart = reader.index + MARKUP.TAG_OPEN.length;
	const nameEnd = findEnd(reader.source, nameStart, endsTagName);
	const nameParts = partsOfRange(reader, nameStart, nameEnd);
	reader.index = nameEnd;

	const isDynamicTag = hasHole(nameParts);
	const tagName = isDynamicTag ? DYNAMIC_TAG_PLACEHOLDER : nameParts.join("");
	if (isDynamicTag) {
		reader.resultMarkup += openMarkerComment(OPEN_CONSTRUCT.TAG, reader.startedBindingCount++);
		reader.bindings.push({ type: BINDING.TAG, parts: nameParts });
	}

	//in the second pass the root template is already ruled out, and nothing there reads a sibling
	const isFirstTag = reader.rootTemplate === ROOT_TEMPLATE.UNDECIDED;
	if (!isFirstTag && isTopLevel(reader)) reader.hasSeenTopLevelSibling = true;
	reader.rootTemplate = rootTemplateAfterOpenTag(reader, tagName);
	const isOnRootTemplate = reader.rootTemplate === ROOT_TEMPLATE.IS_THE_CURRENT_TAG;

	const attributes = readAttributes(reader, tagName);
	reader.resultMarkup += attributes.markerMarkup;
	const openTagMarkup = isOnRootTemplate
		? ""
		: MARKUP.TAG_OPEN + tagName + attributes.attributeMarkup + MARKUP.TAG_CLOSE;

	if (VOID_TAGS.has(tagName.toLowerCase())) {
		reader.resultMarkup += openTagMarkup;
		return;
	}
	if (attributes.isSelfClosing) {
		if (!isOnRootTemplate) {
			reader.resultMarkup += openTagMarkup + MARKUP.END_TAG_OPEN + tagName + MARKUP.TAG_CLOSE;
		}
		return;
	}
	reader.openTagIsDynamic.push(isDynamicTag);
	if (tagName === TEMPLATE_TAG && !isOnRootTemplate) {
		//oxlint-disable-next-line no-use-before-define -- mutual recursion
		const templateContent = readTemplateContent(reader);
		reader.resultMarkup +=
			templateContent.markerMarkup + openTagMarkup + templateContent.contentMarkup;
		readEndTag(reader);
		return;
	}
	if (UNESCAPED_TEXT_TAGS.has(tagName.toLowerCase())) ensureStaticContent(reader, tagName);
	if (!parsesContentAsRaw(tagName)) {
		reader.resultMarkup += openTagMarkup;
		return;
	}
	const rawContent = readRawContent(reader, tagName);
	reader.resultMarkup += rawContent.markerMarkup + openTagMarkup + rawContent.contentMarkup;
	readEndTag(reader);
};

const startsTagName = (source: string, index: number) => {
	const code = source.charCodeAt(index);
	return code === HOLE_CODE || isLetterCode(code);
};

//`<` opens markup only before a letter, `/` and a letter, `!` or a hole; anywhere else it is text,
//as in `a < b`, the way the browser reads it
const markupStartFrom = (source: string, index: number) => {
	let tagStart = source.indexOf(MARKUP.TAG_OPEN, index);
	while (tagStart !== -1) {
		const nextCode = source.charCodeAt(tagStart + 1);
		const opensMarkup =
			nextCode === CHARACTER_CODE.BANG ||
			startsTagName(source, tagStart + 1) ||
			(nextCode === CHARACTER_CODE.SLASH && startsTagName(source, tagStart + 2));
		if (opensMarkup) return tagStart;
		tagStart = source.indexOf(MARKUP.TAG_OPEN, tagStart + 1);
	}
	return tagStart;
};

const TEMPLATE_END_TAG = MARKUP.END_TAG_OPEN + TEMPLATE_TAG;

const startsTemplateEndTag = (source: string, index: number) =>
	source.startsWith(TEMPLATE_END_TAG, index) &&
	endsTagName(source, index + TEMPLATE_END_TAG.length);

const readMarkup = (reader: TemplateReader): void => {
	const { source } = reader;
	while (reader.index < source.length) {
		const tagStart = markupStartFrom(source, reader.index);
		readText(reader, tagStart === -1 ? source.length : tagStart);
		if (tagStart === -1) break;
		const endsTemplateContent =
			reader.isTemplateContent && isTopLevel(reader) && startsTemplateEndTag(source, tagStart);
		if (endsTemplateContent) return;

		const nextCode = source.charCodeAt(tagStart + 1);
		if (source.startsWith(CHARACTER_DATA_OPEN, tagStart)) readCharacterData(reader);
		else if (nextCode === CHARACTER_CODE.BANG) readComment(reader);
		else if (nextCode === CHARACTER_CODE.SLASH) readEndTag(reader);
		else readElement(reader);
	}
	if (reader.isTemplateContent) throw unclosedError("<template>");
};

//the HTML parser puts a nested <template>'s children into its content, where no marker walk of the
//outer template reaches, so the content is read as a template of its own and bound as one hole
const readTemplateContent = (
	reader: TemplateReader,
): { contentMarkup: string; markerMarkup: string } => {
	const firstValueIndex = reader.readHoleCount;
	const contentReader: TemplateReader = {
		...reader,
		resultMarkup: "",
		bindings: [],
		startedBindingCount: 0,
		hostBindingCount: 0,
		hasStyleSheetBinding: false,
		rootTemplate: ROOT_TEMPLATE.RULED_OUT,
		hasSeenTopLevelSibling: false,
		openTagIsDynamic: [],
		isTemplateContent: true,
	};
	readMarkup(contentReader);
	reader.index = contentReader.index;
	reader.readHoleCount = contentReader.readHoleCount;
	reader.nextHoleIndex = contentReader.nextHoleIndex;
	if (contentReader.bindings.length === 0) {
		return { contentMarkup: contentReader.resultMarkup, markerMarkup: "" };
	}

	const valueIndices: Array<number> = [];
	for (let index = firstValueIndex; index < reader.readHoleCount; index++) valueIndices.push(index);
	const bindingIndex = reader.startedBindingCount++;
	reader.bindings.push({
		type: BINDING.TEMPLATE_CONTENT,
		elementName: TEMPLATE_TAG,
		content: {
			htmlWithMarkers: contentReader.resultMarkup,
			bindings: contentReader.bindings,
			templateHash: stringListHash([contentReader.resultMarkup]),
			hostBindingCount: 0,
			hasStyleSheetBinding: contentReader.hasStyleSheetBinding,
			keyValueParts: NO_KEY,
		},
		valueIndices,
	});
	return {
		contentMarkup: "",
		markerMarkup: openMarkerComment(OPEN_CONSTRUCT.RAW_CONTENT, bindingIndex),
	};
};

const parse = (
	strings: TemplateStringsArray,
	mode: ParseModeKind = PARSE_MODE.OPTIMISTIC_ROOT,
): ParsedTemplate => {
	const reader = createTemplateReader(strings, mode);
	readMarkup(reader);

	const hasRootTemplate =
		reader.rootTemplate !== ROOT_TEMPLATE.UNDECIDED &&
		reader.rootTemplate !== ROOT_TEMPLATE.RULED_OUT;
	const isFirstPass = mode === PARSE_MODE.OPTIMISTIC_ROOT;
	if (isFirstPass && hasRootTemplate && reader.hasSeenTopLevelSibling) {
		return parse(strings, PARSE_MODE.NO_ROOT_TEMPLATE);
	}

	return {
		htmlWithMarkers: reader.resultMarkup,
		bindings: reader.bindings,
		templateHash: stringListHash(strings),
		hostBindingCount: reader.hostBindingCount,
		keyValueParts: reader.keyValueParts,
		hasStyleSheetBinding: reader.hasStyleSheetBinding,
	};
};

//a tagged template hands back the same strings array every time it runs, so one parse serves every
//paint of that template for as long as the page holds it
const parseCache = new WeakMap<TemplateStringsArray, ParsedTemplate>();

export const getParsedTemplate = (templateStrings: TemplateStringsArray): ParsedTemplate => {
	const cached = parseCache.get(templateStrings);
	if (cached !== undefined) return cached;
	const parsed = parse(templateStrings);
	parseCache.set(templateStrings, parsed);
	return parsed;
};
