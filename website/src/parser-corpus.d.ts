export type HoleKind = "adjacentContent" | "content" | "singleValueAttribute" | "multiPartAttribute" | "attributeSpread" | "dynamicAttributeName" | "elementTag" | "comment" | "styleDeclaration";
export type ShapeGroup = "hole density" | "part length" | "template count" | "hole kind" | "attribute density" | "control";
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
export declare const generateCorpus: (shape: CorpusShape) => GeneratedCorpus;
export declare const corpusFromRecordedTemplates: (shape: CorpusShape, recorded: ReadonlyArray<RecordedTemplate>) => GeneratedCorpus;
export declare const createFreshTemplateStringsArrays: (corpus: GeneratedCorpus, repeats: number) => Array<TemplateStringsArray>;
export declare const RECORDED_CORPUS_SHAPE: CorpusShape;
export declare const CORPUS_SHAPES: ReadonlyArray<CorpusShape>;
