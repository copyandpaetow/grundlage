const toPrimitive = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (typeof value === "number") return value.toString();
	throw new Error(`Expected string or number, got ${typeof value}`);
};
