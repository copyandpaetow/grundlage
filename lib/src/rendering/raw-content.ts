import { bindingToString } from "../utils/binding-to-string";
import { HTMLTemplate } from "./template-html";

export const updateRawContent = (context: HTMLTemplate, index: number) => {
	const marker = context.markers[index];
	const binding = context.parsedHTML.bindings[index];

	marker.nextElementSibling!.textContent = bindingToString(
		binding.values,
		context.currentExpressions,
	);
};
