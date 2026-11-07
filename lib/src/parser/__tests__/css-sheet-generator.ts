import { Part } from "../types";

//well-formed sheets with holes only in declaration values, the shape real components write
export const createRandom = (seed: number) => () => {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 2 ** 32;
};

type Random = () => number;

const pick = <Item>(random: Random, items: ReadonlyArray<Item>): Item =>
	items[Math.floor(random() * items.length)];

const TOP_SELECTORS = [
	".a",
	"div",
	":host",
	":host(.open)",
	".a, .b",
	".x .y",
	"li:nth-child(2n + 1)",
	":host .inner",
];
const NESTED_SELECTORS = ["&:hover", "& .b", ".c", "&.d", "> .e", "a:hover", ":host &"];
const GROUPING_PRELUDES = [
	"@media (min-width: 600px)",
	"@supports (display: grid)",
	"@layer base",
	"@container (width > 10px)",
	"@scope (.root)",
	"@scope",
	"@starting-style",
];

//each holed value pattern names its property and builds parts from hole slots
const HOLED_PATTERNS: ReadonlyArray<[string, ReadonlyArray<string | null>]> = [
	["--offset", [null, "px"]],
	["width", [null, "px"]],
	["transform", ["rotate(", null, "deg) translateX(", null, "px)"]],
	["color", ["rgb(", null, ", 0, 0)"]],
	["-webkit-line-clamp", [null]],
	["margin", [null, "px ", null, "px"]],
	["--myVar", [" ", null, " "]],
	["opacity", [null]],
];
const STATIC_DECLARATIONS = [
	"color: red",
	"padding: 1px 2px",
	"background: url(a;b.png)",
	'content: "a;b}"',
	"--static: {a}",
	"border: 1px solid rgba(0, 0, 0, 0.5)",
];

interface Builder {
	random: Random;
	parts: Array<Part>;
	text: string;
	holeCount: number;
	holeValues: Array<number>;
}

const write = (builder: Builder, text: string) => {
	builder.text += text;
};

const writeHole = (builder: Builder) => {
	builder.parts.push(builder.text, builder.holeCount++);
	builder.holeValues.push(1 + Math.floor(builder.random() * 90));
	builder.text = "";
};

const writeDeclarations = (builder: Builder) => {
	const { random } = builder;
	const usedNames = new Set<string>();
	const count = Math.floor(random() * 3);
	for (let index = 0; index < count; index++) {
		if (random() < 0.4) {
			write(builder, `${pick(random, STATIC_DECLARATIONS)}; `);
			continue;
		}
		const [name, slots] = pick(random, HOLED_PATTERNS);
		if (usedNames.has(name)) continue;
		usedNames.add(name);
		write(
			builder,
			`${random() < 0.1 ? name.toUpperCase().replace(/^--.*/, name) : name}:${random() < 0.5 ? " " : ""}`,
		);
		for (const slot of slots) slot === null ? writeHole(builder) : write(builder, slot);
		if (random() < 0.1) write(builder, " !important");
		write(builder, random() < 0.2 ? " /* note */; " : "; ");
	}
};

const writeStyleBody = (builder: Builder, depth: number) => {
	const { random } = builder;
	const itemCount = 1 + Math.floor(random() * 3);
	for (let index = 0; index < itemCount; index++) {
		const roll = random();
		if (depth < 3 && roll < 0.25) {
			write(builder, `${pick(random, NESTED_SELECTORS)} { `);
			writeStyleBody(builder, depth + 1);
			write(builder, "} ");
		} else if (depth < 3 && roll < 0.35) {
			write(builder, `${pick(random, GROUPING_PRELUDES.slice(0, 3))} { `);
			writeStyleBody(builder, depth + 1);
			write(builder, "} ");
		} else writeDeclarations(builder);
	}
};

const writeTopLevelItem = (builder: Builder, depth: number) => {
	const { random } = builder;
	const roll = random();
	if (roll < 0.5) {
		write(builder, `${pick(random, TOP_SELECTORS)} { `);
		writeStyleBody(builder, depth + 1);
		write(builder, "}\n");
	} else if (roll < 0.65 && depth < 2) {
		write(builder, `${pick(random, GROUPING_PRELUDES)} {\n`);
		writeTopLevelItem(builder, depth + 1);
		writeTopLevelItem(builder, depth + 1);
		write(builder, "}\n");
	} else if (roll < 0.75) {
		write(builder, "@keyframes spin { from { opacity: 0 } to { ");
		writeDeclarations(builder);
		write(builder, "} }\n");
	} else if (roll < 0.82) write(builder, "@font-face { font-family: x; src: url(x.woff2) }\n");
	else if (roll < 0.88 && depth === 0) write(builder, "@layer one, two;\n");
	else write(builder, "/* } { */\n");
};

export const generateSheet = (random: Random) => {
	const builder: Builder = {
		random,
		parts: [],
		text: "",
		holeCount: 0,
		holeValues: [],
	};
	const itemCount = 1 + Math.floor(random() * 4);
	for (let index = 0; index < itemCount; index++) writeTopLevelItem(builder, 0);
	builder.parts.push(builder.text);
	return { parts: builder.parts, holeValues: builder.holeValues };
};
