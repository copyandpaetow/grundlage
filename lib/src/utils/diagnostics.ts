//tsdown's `define` replaces this in both published builds; running the source (tests, the workspace)
//leaves it undeclared, which counts as development
declare const GRUNDLAGE_IS_DEVELOPMENT_BUILD: boolean | undefined;

export const isDevelopmentBuild =
	typeof GRUNDLAGE_IS_DEVELOPMENT_BUILD === "undefined" ||
	GRUNDLAGE_IS_DEVELOPMENT_BUILD;

export const libraryMessage = (text: string): string => `grundlage: ${text}`;

export const warnDuringDevelopment = (
	message: string,
	detail?: unknown,
): void => {
	if (!isDevelopmentBuild) return;
	if (detail === undefined) console.warn(libraryMessage(message));
	else console.warn(libraryMessage(message), detail);
};

//its own class so every library catch can let it pass: a library bug must not reach a user's
//try/catch or run cleanups on broken state
export class InvariantError extends Error {
	override name = "InvariantError";
}

//the production build inlines the early return, which drops the message and keeps the condition
export const assertDuringDevelopment: (
	condition: unknown,
	invariant: string,
) => asserts condition = (condition, invariant) => {
	if (!isDevelopmentBuild) return;
	if (!condition)
		throw new InvariantError(libraryMessage(`invariant broken: ${invariant}`));
};

//an exception from user code that the library swallowed so teardown could continue; reportError
//hands it to window.onerror trackers, and Node has no reportError
export const reportErrorFromUserCode = (error: unknown): void => {
	if (typeof reportError === "function") reportError(error);
	else console.error(error);
};
