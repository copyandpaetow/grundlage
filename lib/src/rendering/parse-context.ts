import { ValueOf } from "../utils/types";
import {
	isDevelopmentBuild,
	warnDuringDevelopment,
} from "../utils/diagnostics";

export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

export const FOREIGN_CONTENT_ROOT_TAGS = new Set(["svg", "math"]);

//indexes the clone source cache, so it starts at 0
export const PARSE_CONTEXT = { HTML: 0, SVG: 1, MATHML: 2 } as const;
export type ParseContextKind = ValueOf<typeof PARSE_CONTEXT>;

export const WRAPPER_TAG_BY_PARSE_CONTEXT: Record<ParseContextKind, string> = [
	"",
	"svg",
	"math",
];

const SVG_HTML_INTEGRATION_POINTS = new Set(["foreignObject", "desc", "title"]);
const MATHML_TEXT_INTEGRATION_POINTS = new Set([
	"mi",
	"mo",
	"mn",
	"ms",
	"mtext",
]);

export const parseContextOfChildren = (
	parent: Node | null,
): ParseContextKind => {
	if (!(parent instanceof Element)) return PARSE_CONTEXT.HTML;
	switch (parent.namespaceURI) {
		case SVG_NAMESPACE:
			return SVG_HTML_INTEGRATION_POINTS.has(parent.localName)
				? PARSE_CONTEXT.HTML
				: PARSE_CONTEXT.SVG;
		case MATHML_NAMESPACE:
			return MATHML_TEXT_INTEGRATION_POINTS.has(parent.localName)
				? PARSE_CONTEXT.HTML
				: PARSE_CONTEXT.MATHML;
		default:
			return PARSE_CONTEXT.HTML;
	}
};

const TAGS_THAT_CLOSE_PARAGRAPH = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"center",
	"dd",
	"details",
	"dialog",
	"dir",
	"div",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hgroup",
	"hr",
	"li",
	"listing",
	"main",
	"menu",
	"nav",
	"ol",
	"p",
	"plaintext",
	"pre",
	"search",
	"section",
	"summary",
	"table",
	"ul",
	"xmp",
]);

const PARAGRAPH_SCOPE_BOUNDARIES = new Set([
	"applet",
	"button",
	"caption",
	"html",
	"marquee",
	"object",
	"table",
	"td",
	"template",
	"th",
]);

const hasParagraphInButtonScope = (parent: Node | null): boolean => {
	for (
		let ancestor = parent;
		ancestor instanceof Element;
		ancestor = ancestor.parentNode
	) {
		if (ancestor.namespaceURI !== HTML_NAMESPACE) return false;
		if (ancestor.localName === "p") return true;
		if (PARAGRAPH_SCOPE_BOUNDARIES.has(ancestor.localName)) return false;
	}
	return false;
};

//the DOM accepts a <div> inside a <p>, the HTML parser does not: server markup would split the <p>
export const warnWhenParsingWouldSplitParagraph = (
	tagName: string,
	parent: Node | null,
): void => {
	if (!isDevelopmentBuild) return;
	if (!TAGS_THAT_CLOSE_PARAGRAPH.has(tagName.toLowerCase())) return;
	if (!hasParagraphInButtonScope(parent)) return;
	warnDuringDevelopment(
		`<${tagName}> inside <p> renders on the client, but the HTML parser closes the <p> before it, so server-rendered markup hydrates into a different tree. Swap the <p> for a <div>, or move <${tagName}> out of it.`,
	);
};
