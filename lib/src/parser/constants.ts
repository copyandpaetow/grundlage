export const COMMENT_IDENTIFIER = "^.^";

export const EVENT_PREFIX = "on";

export const NO_KEY_BINDING = -1;

export const PARSE_BINDING = {
	TAG: 0,
	ATTRIBUTE: 1,
	CONTENT: 2,
	RAW_CONTENT: 3,
	COMMENT: 4,
} as const;

export const BINDING = {
	TAG: 0,
	ATTRIBUTE: 1,
	DYNAMIC_ATTRIBUTE: 2,
	NAMED_DYNAMIC: 3,
	CONTENT: 4,
	RAW_CONTENT: 5,
	COMMENT: 6,
	SINGLE_VALUE_ATTRIBUTE: 7,
} as const;
