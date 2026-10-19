//the scan reads the page as text and never builds a DOM from it, so every byte around a
//prerendered element reaches the output exactly as it was written

export interface CustomElementRecord {
	tagName: string;
	rawAttributes: string;
	//the element carries `ssr` itself, rather than inheriting it from the page or a parent
	hasOwnPrerenderAttribute: boolean;
	isPrerendered: boolean;
	//index of the nearest enclosing custom element in the same array
	parentIndex: number;
	startIndex: number;
	contentStartIndex: number;
	contentEndIndex: number;
	endIndex: number;
}

export const NO_PARENT = -1;
//an element whose close tag never came has no span to replace
export const NOT_CLOSED = -1;

export const PRERENDER_ATTRIBUTE = "ssr";

export const PRERENDER_CHOICE = { INHERIT: 0, ON: 1, OFF: 2 } as const;
type PrerenderChoiceKind =
	(typeof PRERENDER_CHOICE)[keyof typeof PRERENDER_CHOICE];

const customElementName = "[a-z][a-z0-9._]*-[a-z0-9._-]*";
const attributeText = `((?:"[^"]*"|'[^']*'|[^>])*)`;

//alternatives are tried left to right, so comments and raw-text regions swallow any tag-looking
//text inside them first. A <template> is inert in the browser, so what it holds is not on the
//page; the lookahead keeps a custom element named `template-…` or `style-…` out of that branch
const elementScanPattern = new RegExp(
	`<!--[\\s\\S]*?-->|<(script|style|textarea|template)(?=[\\s/>])[\\s\\S]*?</\\1\\s*>|<(html|body)(?=[\\s/>])${attributeText}>|<(${customElementName})${attributeText}>|</(${customElementName})\\s*>`,
	"g",
);

const attributePattern =
	/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export const parseAttributes = (
	rawAttributes: string,
): Array<[string, string]> => {
	const pairs: Array<[string, string]> = [];
	for (const match of rawAttributes.matchAll(attributePattern)) {
		const [, name, doubleQuoted, singleQuoted, bare] = match;
		pairs.push([name, doubleQuoted ?? singleQuoted ?? bare ?? ""]);
	}
	return pairs;
};

//`null` is an element without the attribute
export const prerenderChoiceOfValue = (
	tagName: string,
	value: string | null,
): PrerenderChoiceKind => {
	if (value === null) return PRERENDER_CHOICE.INHERIT;
	const lowercasedValue = value.toLowerCase();
	if (lowercasedValue === "" || lowercasedValue === "true")
		return PRERENDER_CHOICE.ON;
	if (lowercasedValue === "false") return PRERENDER_CHOICE.OFF;
	throw new Error(
		`[prerender] ssr="${value}" on <${tagName}> is not a value the plugin reads. Use ssr or ssr="true" to prerender the element, ssr="false" to leave it for the client.`,
	);
};

const prerenderChoiceOf = (
	tagName: string,
	rawAttributes: string,
): PrerenderChoiceKind => {
	const attribute = parseAttributes(rawAttributes).find(
		([name]) => name.toLowerCase() === PRERENDER_ATTRIBUTE,
	);
	return prerenderChoiceOfValue(tagName, attribute?.[1] ?? null);
};

const resolvePrerenderChoice = (
	choice: PrerenderChoiceKind,
	isInheritedPrerendered: boolean,
): boolean =>
	choice === PRERENDER_CHOICE.INHERIT
		? isInheritedPrerendered
		: choice === PRERENDER_CHOICE.ON;

//a cheap first look for pages no setting includes: a match only means the full scan runs
export const mayCarryPrerenderAttribute = (html: string): boolean =>
	/\sssr(?=[\s=/>])/i.test(html);

export const findCustomElements = (
	html: string,
	isPageIncluded: boolean,
): Array<CustomElementRecord> => {
	const elements: Array<CustomElementRecord> = [];
	//indexes into `elements` of the custom elements whose close tag is still to come
	const openElementIndexes: Array<number> = [];
	let isPagePrerendered = isPageIncluded;

	for (const match of html.matchAll(elementScanPattern)) {
		const [
			matchedText,
			,
			pageTagName,
			pageTagAttributes = "",
			openTagName,
			openTagAttributes = "",
			closeTagName,
		] = match;

		if (pageTagName !== undefined) {
			isPagePrerendered = resolvePrerenderChoice(
				prerenderChoiceOf(pageTagName, pageTagAttributes),
				isPagePrerendered,
			);
			continue;
		}

		if (openTagName !== undefined) {
			const parentIndex = openElementIndexes.at(-1) ?? NO_PARENT;
			const choice = prerenderChoiceOf(openTagName, openTagAttributes);
			elements.push({
				tagName: openTagName,
				rawAttributes: openTagAttributes,
				hasOwnPrerenderAttribute: choice !== PRERENDER_CHOICE.INHERIT,
				isPrerendered: resolvePrerenderChoice(
					choice,
					parentIndex === NO_PARENT
						? isPagePrerendered
						: elements[parentIndex].isPrerendered,
				),
				parentIndex,
				startIndex: match.index,
				contentStartIndex: match.index + matchedText.length,
				contentEndIndex: NOT_CLOSED,
				endIndex: NOT_CLOSED,
			});
			openElementIndexes.push(elements.length - 1);
			continue;
		}
		if (closeTagName === undefined) continue;

		const openPosition = openElementIndexes.findLastIndex(
			(elementIndex) => elements[elementIndex].tagName === closeTagName,
		);
		if (openPosition === -1) continue;
		const [closedIndex] = openElementIndexes.splice(openPosition);
		elements[closedIndex].contentEndIndex = match.index;
		elements[closedIndex].endIndex = match.index + matchedText.length;
	}

	return elements;
};

//document order puts every ancestor before its descendants, so an ancestor's choice is final by
//the time a descendant asks; an element inside a chosen root is painted as part of it
export const choosePrerenderRoots = (
	elements: ReadonlyArray<CustomElementRecord>,
	isPrerenderable: (tagName: string) => boolean,
): Array<CustomElementRecord> => {
	const chosenIndexes = new Set<number>();
	for (let index = 0; index < elements.length; index++) {
		const element = elements[index];
		if (!element.isPrerendered || element.endIndex === NOT_CLOSED) continue;
		let ancestorIndex = element.parentIndex;
		while (ancestorIndex !== NO_PARENT && !chosenIndexes.has(ancestorIndex))
			ancestorIndex = elements[ancestorIndex].parentIndex;
		if (ancestorIndex !== NO_PARENT) continue;
		if (isPrerenderable(element.tagName)) chosenIndexes.add(index);
	}
	return [...chosenIndexes].map((index) => elements[index]);
};
