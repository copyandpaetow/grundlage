import { CssParsingResult } from "./css/split-rules";

export class CSSTemplate {
	currentValues: Array<unknown>;
	template: CssParsingResult[];
	constructor(template: CssParsingResult[], expressions: Array<unknown>) {
		this.currentValues = expressions;
		this.template = template;
		console.log({ dynamicValues: expressions, template });
	}

	setup() {}

	update() {}
}
