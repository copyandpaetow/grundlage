//the shared first-render sentinel: a template's previousExpressions points here until update() supplies a real prior frame, so `previousExpressions === EMPTY_EXPRESSIONS` is the canonical "no previous render to diff against" test — cheaper and clearer than probing .length. also serves as the empty-list fallback in content.ts.
//lives in its own leaf module (imports nothing) so it stays outside the template-html ↔ content ↔ attribute import cycle that builds updateByType at init time.
export const EMPTY_EXPRESSIONS: Array<unknown> = [];
