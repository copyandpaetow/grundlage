import { AttrHole } from "../types";

export const updateAttr = (
	currentBinding: AttrHole,
	dynamicValues: Array<unknown>
) => {
	const key = currentBinding.keys
		.map((relatedIndex) =>
			typeof relatedIndex === "number"
				? dynamicValues[relatedIndex]
				: relatedIndex
		)
		.join("");
	const value = currentBinding.values
		.map((relatedIndex) =>
			typeof relatedIndex === "number"
				? dynamicValues[relatedIndex]
				: relatedIndex
		)
		.join("");

	currentBinding.start.parentElement!.setAttribute(key, value);
	currentBinding.dirty = false;
};
