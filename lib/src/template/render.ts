import { Result } from "./html";

export const renderDom = (result: Result) => {
	/*

? how to handle end tags?
- spread boolean attributes for complex types, stringify for normal attributes
- handle undefined/null (remove attribute, dont render text)
*/

	return result.fragment;
};
