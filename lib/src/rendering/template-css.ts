import { CssParsingResult } from "./css/split-rules";

export class CSSTemplate {
	currentValues: Array<unknown>;
	template: CssParsingResult[];
	constructor(template: CssParsingResult[], dynamicValues: Array<unknown>) {
		this.currentValues = dynamicValues;
		this.template = template;
		console.log({ dynamicValues, template });
	}

	setup() {}

	update() {}
}
