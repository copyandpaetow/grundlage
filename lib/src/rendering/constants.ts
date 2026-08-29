export const UNSET_HASH = Number.NaN;

export const CONTENT_KIND = {
	UNRESOLVED: 0,
	TEXT: 1,
	BRANCH: 2,
	LIST: 3,
} as const;

export const ATTRIBUTE_MODE = {
	ABSENT: 0,
	ATTRIBUTE: 1,
	PROPERTY: 2,
} as const;

export const NO_KEY = 0;

export const DEFER_HYDRATION_ATTRIBUTE = "defer-hydration";
