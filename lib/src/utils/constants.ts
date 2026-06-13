import { ComponentOptions } from "../types";

export const defaultOptions: ComponentOptions = {
	clonable: true,
	delegatesFocus: true,
	mode: "open",
	serializable: true,
} as const;

//ordered by phase so `>= RENDERING` means "a render is live" and `< RENDERING` means "this flush has already settled (or never started)". the scheduler leans on that ordering instead of a separate `driving` flag
//=> RENDERING_DIRTY folds the old `dirty` bit into the state: a render is in flight AND an update arrived mid-flight, so reflush once on settle
export const UPDATE_STATE = {
	IDLE: 0,
	SCHEDULED: 1,
	RENDERING: 2,
	RENDERING_DIRTY: 3,
} as const;

export const RUNTIME_KIND = { CSR: 1, SSR: 2 } as const;
