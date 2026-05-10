import { ComponentOptions } from "../types";

export const defaultOptions: ComponentOptions = {
	clonable: true,
	delegatesFocus: true,
	mode: "open",
	serializable: true,
} as const;

export const UPDATE_STATE = {
	IDLE: 0,
	SCHEDULED: 1,
	RENDERING: 2,
} as const;

export const RENDER_MODE = {
	SSR: 1,
	CSR: 2,
} as const;

export const TEMPLATE_SOURCE_TYPE = {
	STATIC: 0,
	RENDER_FUNCTION: 1,
	GENERATOR: 2,
} as const;

export const RECOVERY_ATTEMPT_TYPE = {
	CAUGHT: 0,
	UNCAUGHT: 1,
} as const;
