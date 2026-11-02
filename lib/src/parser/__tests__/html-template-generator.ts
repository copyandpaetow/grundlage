//well-formed templates with holes where the bindings table allows them, each hole tagged with how
//the browser would read its value if the app had written it into the markup itself
export const createRandom = (seed: number) => () => {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 2 ** 32;
};

type Random = () => number;

const pick = <Item>(random: Random, items: ReadonlyArray<Item>): Item =>
	items[Math.floor(random() * items.length)];

export type HoleContext =
	| "content"
	| "double-quoted"
	| "single-quoted"
	| "unquoted"
	| "raw-text"
	| "css-number"
	| "tag-name"
	| "inline-tag-name";

const CONTENT_VALUES = [
	"",
	"x",
	"a<b",
	"&amp;",
	"<i>not markup</i>",
	`"quoted' both`,
	"  spaced  ",
	"-->",
	0,
	42,
	-1.5,
];
const TAG_VALUES = ["section", "article", "my-box"];
const INLINE_TAG_VALUES = ["span", "em", "my-box"];
const ATTRIBUTE_NAMES = [
	"class",
	"title",
	"id",
	"data-a",
	"aria-label",
	"lang",
];
const CONTAINER_TAGS = ["div", "span", "p", "b", "section", "my-box", "DIV"];
const PHRASING_CONTAINER_TAGS = ["span", "b", "my-box"];
const VOID_TAGS = ["br", "img", "hr", "wbr"];
const PHRASING_VOID_TAGS = ["br", "img", "wbr"];
const STATIC_TEXTS = [
	"text",
	"a &gt; b",
	"&amp;&lt;",
	"&nbsp;",
	"a > b",
	" ",
	"\n\t",
	"x = y",
	"don't",
];
const STATIC_ATTRIBUTE_VALUES = ["v", "a b", "a>b", "a=b", "&amp;", ""];

interface Builder {
	random: Random;
	strings: Array<string>;
	text: string;
	//the library closes `<div/>` at once, the browser ignores its slash, so the two texts part there
	handWrittenStrings: Array<string>;
	handWrittenText: string;
	contexts: Array<HoleContext>;
	depth: number;
	paragraphDepth: number;
}

const write = (builder: Builder, text: string, handWrittenText = text) => {
	builder.text += text;
	builder.handWrittenText += handWrittenText;
};

const writeHole = (builder: Builder, context: HoleContext) => {
	builder.strings.push(builder.text);
	builder.handWrittenStrings.push(builder.handWrittenText);
	builder.text = "";
	builder.handWrittenText = "";
	builder.contexts.push(context);
};

const separator = (random: Random) => pick(random, [" ", " ", "\n\t", "  "]);

const writeAttributes = (builder: Builder) => {
	const { random } = builder;
	const names = [...ATTRIBUTE_NAMES]
		.sort(() => random() - 0.5)
		.slice(0, Math.floor(random() * 3));
	for (const name of names) {
		write(builder, separator(random));
		const spelledName = random() < 0.1 ? name.toUpperCase() : name;
		const roll = random();
		if (roll < 0.15) write(builder, spelledName);
		else if (roll < 0.3)
			write(
				builder,
				`${spelledName}="${pick(random, STATIC_ATTRIBUTE_VALUES)}"`,
			);
		else if (roll < 0.4)
			write(
				builder,
				`${spelledName}='${pick(random, STATIC_ATTRIBUTE_VALUES)}'`,
			);
		else if (roll < 0.45) write(builder, `${spelledName}=v`);
		else if (roll < 0.6) {
			write(builder, `${spelledName}=`);
			writeHole(builder, "unquoted");
		} else if (roll < 0.8) {
			write(builder, `${spelledName}="${random() < 0.5 ? "pre " : ""}`);
			writeHole(builder, "double-quoted");
			if (random() < 0.4) {
				write(builder, random() < 0.5 ? " " : "-");
				writeHole(builder, "double-quoted");
			}
			write(builder, random() < 0.5 ? ` post"` : `"`);
		} else {
			write(builder, `${spelledName}='`);
			writeHole(builder, "single-quoted");
			write(builder, `'`);
		}
	}
	if (random() < 0.1) write(builder, separator(random));
};

const writeChildren = (builder: Builder) => {
	const { random } = builder;
	const count = Math.floor(random() * 4);
	for (let index = 0; index < count; index++) writeNode(builder);
};

const writeNode = (builder: Builder) => {
	const { random } = builder;
	const roll = random();
	const canNest = builder.depth < 4;
	//the browser closes a <p> before a block and copies open formatting elements past it, so a <p>
	//holds phrasing content only
	const isInsideParagraph = builder.paragraphDepth > 0;
	if (roll < 0.2) {
		writeHole(builder, "content");
		return;
	}
	if (roll < 0.35) {
		write(builder, pick(random, STATIC_TEXTS));
		return;
	}
	if (roll < 0.4) {
		write(
			builder,
			pick(random, ["<!-- note -->", "<!---->", "<!-- a > b -->"]),
		);
		return;
	}
	if (roll < 0.47) {
		write(
			builder,
			`<${pick(random, isInsideParagraph ? PHRASING_VOID_TAGS : VOID_TAGS)}`,
		);
		writeAttributes(builder);
		write(builder, random() < 0.5 ? " />" : ">");
		return;
	}
	if (roll < 0.52) {
		write(builder, "<textarea>");
		if (random() < 0.7) writeHole(builder, "raw-text");
		write(builder, "</textarea>");
		return;
	}
	if (roll < 0.57) {
		write(builder, "<style>p { width: ");
		writeHole(builder, "css-number");
		write(builder, "px; color: red }</style>");
		return;
	}
	if (roll < 0.65 && isInsideParagraph) {
		writeHole(builder, "content");
		return;
	}
	if (roll < 0.62 && canNest) {
		write(builder, "<ul>");
		write(builder, "<li>");
		writeHole(builder, "content");
		write(builder, "</li><li>static</li></ul>");
		return;
	}
	if (roll < 0.65 && canNest) {
		const hasBody = random() < 0.5;
		write(builder, hasBody ? "<table><tbody><tr" : "<table><tr");
		writeAttributes(builder);
		write(builder, "><td>");
		writeHole(builder, "content");
		write(
			builder,
			hasBody ? "</td></tr></tbody></table>" : "</td></tr></table>",
		);
		return;
	}
	if (roll < 0.7 && canNest) {
		//a <section> built by the DOM stays inside a <p>, where parsed markup would close the <p>
		const tagContext =
			builder.paragraphDepth > 0 ? "inline-tag-name" : "tag-name";
		write(builder, "<");
		writeHole(builder, tagContext);
		writeAttributes(builder);
		write(builder, ">");
		builder.depth++;
		writeChildren(builder);
		builder.depth--;
		write(builder, "</");
		writeHole(builder, tagContext);
		write(builder, ">");
		return;
	}
	if (roll < 0.73) {
		write(builder, `<svg viewBox="0 0 10 10"><circle r="`);
		writeHole(builder, "double-quoted");
		write(builder, `"></circle></svg>`);
		return;
	}
	if (!canNest) {
		writeHole(builder, "content");
		return;
	}
	const tag = pick(
		random,
		isInsideParagraph ? PHRASING_CONTAINER_TAGS : CONTAINER_TAGS,
	);
	write(builder, `<${tag}`);
	writeAttributes(builder);
	if (random() < 0.05) {
		write(builder, "/>", `></${tag}>`);
		return;
	}
	write(builder, ">");
	const isParagraph = tag === "p";
	builder.depth++;
	if (isParagraph) builder.paragraphDepth++;
	writeChildren(builder);
	if (isParagraph) builder.paragraphDepth--;
	builder.depth--;
	write(builder, `</${tag}>`);
};

const valueFor = (random: Random, context: HoleContext): string | number => {
	if (context === "tag-name") return pick(random, TAG_VALUES);
	if (context === "inline-tag-name") return pick(random, INLINE_TAG_VALUES);
	if (context === "css-number") return 1 + Math.floor(random() * 90);
	return pick(random, CONTENT_VALUES);
};

export interface GeneratedTemplate {
	strings: TemplateStringsArray;
	handWrittenStrings: ReadonlyArray<string>;
	contexts: ReadonlyArray<HoleContext>;
	valuesOf: (random: Random) => Array<string | number>;
}

export const generateTemplate = (random: Random): GeneratedTemplate => {
	const builder: Builder = {
		random,
		strings: [],
		text: "",
		handWrittenStrings: [],
		handWrittenText: "",
		contexts: [],
		depth: 0,
		paragraphDepth: 0,
	};
	const count = 1 + Math.floor(random() * 3);
	for (let index = 0; index < count; index++) writeNode(builder);
	builder.strings.push(builder.text);
	builder.handWrittenStrings.push(builder.handWrittenText);
	const { contexts, handWrittenStrings } = builder;
	//both tag holes of one element name the same tag
	const valuesOf = (valueRandom: Random) => {
		const values: Array<string | number> = [];
		const openTagValues: Array<string | number> = [];
		for (let index = 0; index < contexts.length; index++) {
			const context = contexts[index];
			const isTagName = context === "tag-name" || context === "inline-tag-name";
			const isCloseTag = isTagName && builder.strings[index].endsWith("</");
			if (isCloseTag) {
				values.push(openTagValues.pop()!);
				continue;
			}
			const value = valueFor(valueRandom, context);
			if (isTagName) openTagValues.push(value);
			values.push(value);
		}
		return values;
	};
	const strings = Object.assign([...builder.strings], {
		raw: [...builder.strings],
	});
	//a hand-built strings array stands in for the one a tagged template hands over
	return {
		strings: strings as unknown as TemplateStringsArray,
		handWrittenStrings,
		contexts,
		valuesOf,
	};
};

const escapeText = (text: string) =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

//the markup the app would have written by hand for these values
export const handWrittenMarkupOf = (
	generated: GeneratedTemplate,
	values: ReadonlyArray<string | number>,
): string => {
	const { handWrittenStrings, contexts } = generated;
	let markup = handWrittenStrings[0];
	for (let index = 0; index < contexts.length; index++) {
		const text = String(values[index]);
		const context = contexts[index];
		switch (context) {
			case "content":
			case "raw-text":
				markup += escapeText(text);
				break;
			case "double-quoted":
				markup += text.replaceAll("&", "&amp;").replaceAll(`"`, "&quot;");
				break;
			case "single-quoted":
				markup += text.replaceAll("&", "&amp;").replaceAll(`'`, "&#39;");
				break;
			case "unquoted":
				markup += `"${text.replaceAll("&", "&amp;").replaceAll(`"`, "&quot;")}"`;
				break;
			case "css-number":
			case "tag-name":
			case "inline-tag-name":
				markup += text;
				break;
			default:
				context satisfies never;
		}
		markup += handWrittenStrings[index + 1];
	}
	return markup;
};
