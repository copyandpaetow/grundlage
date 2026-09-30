export const UNSET_HASH = Number.NaN;

//no attribute name is empty, so a name compared against it never matches
export const NO_ATTRIBUTE_WRITTEN = "";

export const CONTENT_KIND = {
	UNRESOLVED: 70,
	TEXT: 71,
	BRANCH: 72,
	LIST: 73,
} as const;

export const STYLE_SHEET_LANE = {
	TEXT: 80,
	CSSOM: 81,
} as const;

export const ATTRIBUTE_MODE = {
	ABSENT: 90,
	ATTRIBUTE: 91,
	PROPERTY: 92,
} as const;

export const DEFER_HYDRATION_ATTRIBUTE = "defer-hydration";
