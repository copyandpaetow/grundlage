//tsdown's `define` replaces this in both published builds; running the source (tests, the workspace)
//leaves it undeclared, which counts as development
declare const GRUNDLAGE_IS_DEVELOPMENT_BUILD: boolean | undefined;

export const isDevelopmentBuild =
	typeof GRUNDLAGE_IS_DEVELOPMENT_BUILD === "undefined" ||
	GRUNDLAGE_IS_DEVELOPMENT_BUILD;

export const warnDuringDevelopment = (message: string, detail?: unknown): void => {
	if (!isDevelopmentBuild) return;
	if (detail === undefined) console.warn(`grundlage: ${message}`);
	else console.warn(`grundlage: ${message}`, detail);
};

//an exception from user code that the library swallowed so teardown could continue; reportError
//hands it to window.onerror trackers, and Node has no reportError
export const reportErrorFromUserCode = (error: unknown): void => {
	if (typeof reportError === "function") reportError(error);
	else console.error(error);
};
