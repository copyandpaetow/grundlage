import { bindingToString } from "../utils/binding-to-string";
import { HTMLTemplate } from "./template-html";

export const updateRawContent = (context: HTMLTemplate, index: number) => {
	const element = context.targets[index] as Element;
	const binding = context.parsedHTML.bindings[index];

	element.textContent = bindingToString(
		binding.values,
		context.currentExpressions,
	);
};
