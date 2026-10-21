//a hyphenated unknown element is phrasing content to the HTML parser, so it closes no open <p>
export const DYNAMIC_TAG_PLACEHOLDER = "grundlage-tag";

export const NO_KEY: unique symbol = Symbol("no key");

//nothing dynamic to address, or a sheet the compiler cannot map onto the CSSOM: both write text
export const STYLE_SHEET_NOT_COMPILED: unique symbol = Symbol(
	"style sheet not compiled",
);
