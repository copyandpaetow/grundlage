export const OPEN_CONSTRUCT = {
	TAG: 10,
	ATTRIBUTE: 11,
	CONTENT: 12,
	RAW_CONTENT: 13,
	COMMENT: 14,
} as const;

export const NO_KEY: unique symbol = Symbol("no key");

//nothing dynamic to address, or a sheet the compiler cannot map onto the CSSOM: both write text
export const STYLE_SHEET_NOT_COMPILED: unique symbol = Symbol(
	"style sheet not compiled",
);

export const BINDING = {
	TAG: 20,
	ATTRIBUTE: 21,
	DYNAMIC_ATTRIBUTE: 22,
	CONTENT: 23,
	RAW_CONTENT: 24,
	COMMENT: 25,
} as const;
