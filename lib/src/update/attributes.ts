import { DynamicPart } from "../types";

export const updateAttr = (currentBinding: DynamicPart) => {
	const key = currentBinding.key.join("");
	const value = currentBinding.value.join("");

	currentBinding.start.parentElement!.setAttribute(key, value);
};
