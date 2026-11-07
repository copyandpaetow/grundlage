import { combinedPartsHash } from "../compose";
import { cloneTemplateFragment, mountInstance } from "../instance";
import { elementAfterMarker, removeMarkers } from "../markers";
import { TemplateContentLiveBinding } from "./types";
import { assertDuringDevelopment } from "../../utils/diagnostics";

//the content is inert and only ever copied, so each change mounts it fresh and drops the instance:
//no binding lives inside it between paints
export const commitTemplateContent = (
	liveBinding: TemplateContentLiveBinding,
	values: Array<unknown>,
): void => {
	const { content, valueIndices } = liveBinding.staticBinding;
	const hash = combinedPartsHash(valueIndices, values);
	if (hash === liveBinding.lastValueHash) return;
	const fragment = cloneTemplateFragment(content, null);
	mountInstance(fragment, values, content, {
		needsStyleSheetRefreshOnMove: false,
		isTemplateContent: true,
	});
	removeMarkers(fragment);
	const template = elementAfterMarker(liveBinding.openMarker);
	assertDuringDevelopment(
		template instanceof HTMLTemplateElement,
		"the parser binds template content only on a <template>",
	);
	template.content.replaceChildren(fragment);
	liveBinding.lastValueHash = hash;
};

//the server already wrote the content from these values
export const hydrateTemplateContent = (
	liveBinding: TemplateContentLiveBinding,
	values: Array<unknown>,
): void => {
	liveBinding.lastValueHash = combinedPartsHash(
		liveBinding.staticBinding.valueIndices,
		values,
	);
};
