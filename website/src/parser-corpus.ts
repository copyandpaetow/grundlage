/*
    Synthetic template corpora for the parser bench.

    The parser's cost has two independent terms and one instrument can only see
    one of them. Compile + cold-tier execution is ~95% of first-load cost and
    scales with the parser's own shipped bytes, not with its input; it is not
    measurable in a warm page and is read from the gzip size instead. What this
    file feeds is the other term: per-character work in a warm isolate.

    Shapes are generated rather than collected so every axis moves alone:

      hole density      characters held fixed, holes varied. The ns/char line
                        through these points gives a scanner cost (intercept)
                        and a per-hole cost (slope). The per-hole slope is what
                        the pooled parser buffers exist to defend.
      part length       holes held fixed, characters varied. Isolates substring
                        extraction from binding creation: flat ns/char means
                        slicing is linear and cheap.
      template count    total characters held fixed, split across more or fewer
                        templates. Separates per-template fixed cost from
                        per-character cost.
      hole kind         one lane per binding kind at equal hole count, including
                        the <style> path (a second parser) and the comment lane
                        that the recorded corpus never exercises.
      attribute density static attributes with no holes: the attribute scanner
                        without any binding allocation.
      control           the templates actually recorded off this site. A win on
                        synthetic shapes that loses here is tuning for a phantom.
*/

export type HoleKind =
	| "adjacentContent"
	| "content"
	| "singleValueAttribute"
	| "multiPartAttribute"
	| "attributeSpread"
	| "dynamicAttributeName"
	| "elementTag"
	| "comment"
	| "styleDeclaration";

export type ShapeGroup =
	| "hole density"
	| "part length"
	| "template count"
	| "hole kind"
	| "attribute density"
	| "control";

export interface CorpusShape {
	name: string;
	group: ShapeGroup;
	hypothesis: string;
	templateCount: number;
	holesPerTemplate: number;
	charactersPerTemplate: number;
	holeKind: HoleKind;
	staticAttributesPerElement: number;
	/** Only read when holesPerTemplate is 0: how many static elements to emit. */
	elementsPerTemplate?: number;
}

export interface RecordedTemplate {
	strings: Array<string>;
	raw: Array<string>;
}

export interface GeneratedCorpus {
	shape: CorpusShape;
	templates: Array<RecordedTemplate>;
	totalCharacters: number;
	totalHoles: number;
}

// --- filler --------------------------------------------------------------

const FILLER_WORDS = [
	"alpha",
	"beta",
	"gamma",
	"delta",
	"epsilon",
	"zeta",
	"eta",
	"theta",
	"iota",
	"kappa",
	"lambda",
	"mu",
];

/** Plain words, no markup-significant characters, varied per template so V8 cannot share one internalized string across the corpus. */
const buildTextFiller = (characterCount: number, seed: number): string => {
	if (characterCount <= 0) return "";
	let text = "";
	let wordIndex = seed;
	while (text.length < characterCount) {
		text += `${FILLER_WORDS[wordIndex % FILLER_WORDS.length]} `;
		wordIndex++;
	}
	return text.slice(0, characterCount);
};

const FILLER_DECLARATIONS = [
	"padding:0;",
	"margin:0;",
	"border-width:0;",
	"font-weight:400;",
	"letter-spacing:normal;",
];

/** Whole declarations up to the budget, then spaces — a truncated declaration would not parse. */
const buildDeclarationFiller = (
	characterCount: number,
	seed: number,
): string => {
	if (characterCount <= 0) return "";
	let text = "";
	let declarationIndex = seed;
	while (true) {
		const next =
			FILLER_DECLARATIONS[declarationIndex % FILLER_DECLARATIONS.length];
		if (text.length + next.length > characterCount) break;
		text += next;
		declarationIndex++;
	}
	return text.padEnd(characterCount, " ");
};

const buildStaticAttributeText = (attributeCount: number): string => {
	let text = "";
	for (let index = 0; index < attributeCount; index++) {
		text += ` data-${FILLER_WORDS[index % FILLER_WORDS.length]}="${index}"`;
	}
	return text;
};

// --- hole patterns -------------------------------------------------------

interface HolePattern {
	holesPerUnit: number;
	documentOpen: string;
	documentClose: string;
	/** Static text preceding each hole of one unit. Length is holesPerUnit. */
	staticsBeforeHoles(
		unitIndex: number,
		attributeText: string,
		filler: string,
	): Array<string>;
	/** Static text following the unit's last hole. */
	staticAfterUnit(unitIndex: number, filler: string): string;
	fillerIsDeclarations: boolean;
}

const HOLE_PATTERNS: Record<HoleKind, HolePattern> = {
	adjacentContent: {
		holesPerUnit: 1,
		documentOpen: `<div class="root">`,
		documentClose: `</div>`,
		staticsBeforeHoles: () => [``],
		staticAfterUnit: (_unitIndex, filler) => filler,
		fillerIsDeclarations: false,
	},
	content: {
		holesPerUnit: 1,
		documentOpen: `<div class="root">`,
		documentClose: `</div>`,
		staticsBeforeHoles: (_unitIndex, attributeText) => [`<p${attributeText}>`],
		staticAfterUnit: (_unitIndex, filler) => `${filler}</p>`,
		fillerIsDeclarations: false,
	},
	singleValueAttribute: {
		holesPerUnit: 1,
		documentOpen: `<div class="root">`,
		documentClose: `</div>`,
		staticsBeforeHoles: (_unitIndex, attributeText) => [
			`<span${attributeText} id="`,
		],
		staticAfterUnit: (_unitIndex, filler) => `">${filler}</span>`,
		fillerIsDeclarations: false,
	},
	multiPartAttribute: {
		holesPerUnit: 1,
		documentOpen: `<div class="root">`,
		documentClose: `</div>`,
		staticsBeforeHoles: (_unitIndex, attributeText) => [
			`<span${attributeText} class="alpha `,
		],
		staticAfterUnit: (_unitIndex, filler) => ` omega">${filler}</span>`,
		fillerIsDeclarations: false,
	},
	attributeSpread: {
		holesPerUnit: 1,
		documentOpen: `<div class="root">`,
		documentClose: `</div>`,
		staticsBeforeHoles: (_unitIndex, attributeText) => [
			`<span${attributeText} `,
		],
		staticAfterUnit: (_unitIndex, filler) => `>${filler}</span>`,
		fillerIsDeclarations: false,
	},
	dynamicAttributeName: {
		holesPerUnit: 1,
		documentOpen: `<div class="root">`,
		documentClose: `</div>`,
		staticsBeforeHoles: (_unitIndex, attributeText) => [
			`<span${attributeText} `,
		],
		staticAfterUnit: (_unitIndex, filler) => `="value">${filler}</span>`,
		fillerIsDeclarations: false,
	},
	elementTag: {
		holesPerUnit: 2,
		documentOpen: `<div class="root">`,
		documentClose: `</div>`,
		staticsBeforeHoles: (_unitIndex, attributeText, filler) => [
			`<h`,
			`${attributeText}>${filler}</h`,
		],
		staticAfterUnit: () => `>`,
		fillerIsDeclarations: false,
	},
	comment: {
		holesPerUnit: 1,
		documentOpen: `<div class="root">`,
		documentClose: `</div>`,
		staticsBeforeHoles: () => [`<!-- `],
		staticAfterUnit: (_unitIndex, filler) => ` -->${filler}`,
		fillerIsDeclarations: false,
	},
	styleDeclaration: {
		holesPerUnit: 1,
		documentOpen: `<style>`,
		documentClose: `</style><div class="root">text</div>`,
		staticsBeforeHoles: (unitIndex) => [`.rule-${unitIndex}{color:`],
		staticAfterUnit: (_unitIndex, filler) => `;${filler}}`,
		fillerIsDeclarations: true,
	},
};

// --- generation ----------------------------------------------------------

const assembleTemplate = (
	pattern: HolePattern,
	unitCount: number,
	attributeText: string,
	fillerPerUnit: string,
): Array<string> => {
	const statics: Array<string> = [];
	let current = pattern.documentOpen;

	for (let unitIndex = 0; unitIndex < unitCount; unitIndex++) {
		const before = pattern.staticsBeforeHoles(
			unitIndex,
			attributeText,
			fillerPerUnit,
		);
		for (let holeIndex = 0; holeIndex < before.length; holeIndex++) {
			current += before[holeIndex];
			statics.push(current);
			current = "";
		}
		current += pattern.staticAfterUnit(unitIndex, fillerPerUnit);
	}

	current += pattern.documentClose;
	statics.push(current);
	return statics;
};

const totalCharactersOf = (statics: ReadonlyArray<string>): number => {
	let total = 0;
	for (let index = 0; index < statics.length; index++)
		total += statics[index].length;
	return total;
};

const generateStaticOnlyTemplate = (
	shape: CorpusShape,
	templateIndex: number,
): RecordedTemplate => {
	const attributeText = buildStaticAttributeText(
		shape.staticAttributesPerElement,
	);
	const elementCount = Math.max(1, shape.elementsPerTemplate ?? 1);
	const perElementMarkup = `<p${attributeText}></p>`;
	const overhead = 25 + perElementMarkup.length * elementCount;
	const filler = buildTextFiller(
		Math.floor(
			Math.max(0, shape.charactersPerTemplate - overhead) / elementCount,
		),
		templateIndex,
	);

	let html = `<div class="root">`;
	for (let elementIndex = 0; elementIndex < elementCount; elementIndex++) {
		html += `<p${attributeText}>${filler}</p>`;
	}
	html += `</div>`;
	return { strings: [html], raw: [html] };
};

const generateTemplate = (
	shape: CorpusShape,
	templateIndex: number,
): RecordedTemplate => {
	if (shape.holesPerTemplate === 0)
		return generateStaticOnlyTemplate(shape, templateIndex);

	const pattern = HOLE_PATTERNS[shape.holeKind];
	const attributeText = buildStaticAttributeText(
		shape.staticAttributesPerElement,
	);
	const unitCount = Math.ceil(shape.holesPerTemplate / pattern.holesPerUnit);

	// Built once empty to learn the markup overhead, then the remaining
	// character budget is spent on filler. Exact beats modelled here.
	const withoutFiller = assembleTemplate(pattern, unitCount, attributeText, "");
	const fillerBudget = Math.max(
		0,
		shape.charactersPerTemplate - totalCharactersOf(withoutFiller),
	);
	const charactersPerUnit = Math.floor(fillerBudget / unitCount);
	const filler = pattern.fillerIsDeclarations
		? buildDeclarationFiller(charactersPerUnit, templateIndex)
		: buildTextFiller(charactersPerUnit, templateIndex);

	const statics = assembleTemplate(pattern, unitCount, attributeText, filler);
	return { strings: statics, raw: statics.slice() };
};

export const generateCorpus = (shape: CorpusShape): GeneratedCorpus => {
	const templates: Array<RecordedTemplate> = [];
	let totalCharacters = 0;
	let totalHoles = 0;

	for (
		let templateIndex = 0;
		templateIndex < shape.templateCount;
		templateIndex++
	) {
		const template = generateTemplate(shape, templateIndex);
		templates.push(template);
		totalCharacters += totalCharactersOf(template.strings);
		totalHoles += template.strings.length - 1;
	}

	return { shape, templates, totalCharacters, totalHoles };
};

export const corpusFromRecordedTemplates = (
	shape: CorpusShape,
	recorded: ReadonlyArray<RecordedTemplate>,
): GeneratedCorpus => {
	let totalCharacters = 0;
	let totalHoles = 0;
	for (let index = 0; index < recorded.length; index++) {
		totalCharacters += totalCharactersOf(recorded[index].strings);
		totalHoles += recorded[index].strings.length - 1;
	}
	return {
		shape,
		templates: recorded.slice(),
		totalCharacters,
		totalHoles,
	};
};

/*
    A TemplateStringsArray is the parse cache's WeakMap key, so every measured
    parse needs a fresh array. The string primitives are shared on purpose: a
    real re-parse sees interned strings too, and rebuilding them would move
    allocation into the timed region.
*/
export const createFreshTemplateStringsArrays = (
	corpus: GeneratedCorpus,
	repeats: number,
): Array<TemplateStringsArray> => {
	const arrays: Array<TemplateStringsArray> = [];
	for (let repeat = 0; repeat < repeats; repeat++) {
		for (let index = 0; index < corpus.templates.length; index++) {
			const template = corpus.templates[index];
			arrays.push(
				Object.assign(template.strings.slice(), {
					raw: template.raw.slice(),
				}) as unknown as TemplateStringsArray,
			);
		}
	}
	return arrays;
};

// --- shapes --------------------------------------------------------------

const holeDensityShape = (
	holeKind: HoleKind,
	holesPerTemplate: number,
): CorpusShape => ({
	name: `${holeKind === "adjacentContent" ? "adjacent" : "per element"} · ${holesPerTemplate} holes`,
	group: "hole density",
	hypothesis:
		holeKind === "adjacentContent"
			? "holes vary, element count does not: the slope is pure per-hole cost"
			: "each hole brings its own element: the slope is per-hole plus per-element",
	templateCount: 8,
	holesPerTemplate,
	charactersPerTemplate: 6000,
	holeKind,
	staticAttributesPerElement: 0,
	elementsPerTemplate: 1,
});

const HOLE_KIND_LANES: ReadonlyArray<HoleKind> = [
	"adjacentContent",
	"content",
	"singleValueAttribute",
	"multiPartAttribute",
	"attributeSpread",
	"dynamicAttributeName",
	"elementTag",
	"comment",
	"styleDeclaration",
];

export const RECORDED_CORPUS_SHAPE: CorpusShape = {
	name: "recorded · this site",
	group: "control",
	hypothesis:
		"the templates this site actually ships; vetoes a win that only exists on synthetic shapes",
	templateCount: 0,
	holesPerTemplate: 0,
	charactersPerTemplate: 0,
	holeKind: "content",
	staticAttributesPerElement: 0,
};

export const CORPUS_SHAPES: ReadonlyArray<CorpusShape> = [
	...[0, 8, 32, 128, 512].map((holes) =>
		holeDensityShape("adjacentContent", holes),
	),
	...[8, 32, 128, 512].map((holes) => holeDensityShape("content", holes)),

	...[3000, 6000, 12000, 24000].map((characters) => ({
		name: `${characters / 1000}k chars · 32 holes`,
		group: "part length" as const,
		hypothesis:
			"holes fixed, characters varied: flat ns/char means slicing is linear and cheap",
		templateCount: 8,
		holesPerTemplate: 32,
		charactersPerTemplate: characters,
		holeKind: "adjacentContent" as const,
		staticAttributesPerElement: 0,
	})),

	...[
		{ templateCount: 1, charactersPerTemplate: 48000, holesPerTemplate: 256 },
		{ templateCount: 8, charactersPerTemplate: 6000, holesPerTemplate: 32 },
		{ templateCount: 64, charactersPerTemplate: 750, holesPerTemplate: 4 },
		{ templateCount: 256, charactersPerTemplate: 188, holesPerTemplate: 1 },
	].map((split) => ({
		name: `${split.templateCount} × ${split.charactersPerTemplate} chars`,
		group: "template count" as const,
		hypothesis:
			"48k characters and ~256 holes either way: the spread is per-template fixed cost",
		holeKind: "content" as const,
		staticAttributesPerElement: 0,
		...split,
	})),

	...HOLE_KIND_LANES.map((holeKind) => ({
		name: `lane · ${holeKind}`,
		group: "hole kind" as const,
		hypothesis:
			"equal holes and characters across every binding lane; the spread is what each lane costs",
		templateCount: 8,
		holesPerTemplate: 32,
		charactersPerTemplate: 6000,
		holeKind,
		staticAttributesPerElement: 0,
	})),

	...[0, 4, 12].map((attributeCount) => ({
		name: `${attributeCount} attributes / element`,
		group: "attribute density" as const,
		hypothesis:
			"no holes at all: the attribute scanner without a single binding allocation",
		templateCount: 8,
		holesPerTemplate: 0,
		charactersPerTemplate: 6000,
		holeKind: "content" as const,
		staticAttributesPerElement: attributeCount,
		elementsPerTemplate: 20,
	})),
];
