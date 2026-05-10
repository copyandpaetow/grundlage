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

export const EPOCH_TYPE = {
	STATIC: 0,
	RENDERER: 1,
	GENERATOR: 2,
} as const;
