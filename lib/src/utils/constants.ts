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

export const RUNTIME_KIND = { CSR: 1, SSR: 2 } as const;
