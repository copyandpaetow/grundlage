//we cache the prototypes here — comparing against these is a single reference check vs. walking the prototype chain via instanceof
const generatorFunctionPrototype = Object.getPrototypeOf(function* () {});
const asyncGeneratorFunctionPrototype = Object.getPrototypeOf(
	async function* () {},
);

export const isGeneratorFunction = (value: unknown): boolean => {
	if (typeof value !== "function") return false;
	const prototype = Object.getPrototypeOf(value);
	return (
		prototype === generatorFunctionPrototype ||
		prototype === asyncGeneratorFunctionPrototype
	);
};
