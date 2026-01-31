import { descriptorToString } from "../utils/descriptor-to-string";
import { HTMLTemplate } from "./template-html";

export const updateRawContent = (context: HTMLTemplate, index: number) => {
	const marker = context.markers[index];
	const descriptor = context.parsedHTML.descriptors[index];

	marker.nextElementSibling!.textContent = descriptorToString(
		descriptor.values,
		context.currentExpressions,
	);
};
