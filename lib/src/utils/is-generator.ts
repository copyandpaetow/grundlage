export const isGeneratorLike = (
	value: unknown,
): value is Generator | AsyncGenerator => {
	if (value === null || typeof value !== "object") return false;
	const candidate = value as { next?: unknown };
	return typeof candidate.next === "function";
};
