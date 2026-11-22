//oxlint-disable import/no-cycle -- mutual recursion: a template holds templates
import { combinedPartsHash } from "../compose";
import { cloneTemplateFragment, mountInstance } from "../instance";
import { elementAfterMarker, removeMarkers } from "../markers";
import { TemplateContentLiveBinding } from "./types";
import { libraryMessage } from "../../utils/diagnostics";

//the content is inert and only ever copied, so each change mounts it fresh and drops the instance:
//no binding lives inside it between paints
export const commitTemplateContent = (
	liveBinding: TemplateContentLiveBinding,
	values: Array<unknown>,
): void => {
	const hash = combinedPartsHash(liveBinding.staticBinding.valueIndices, values);
	if (hash === liveBinding.lastValueHash) return;
	const template = elementAfterMarker(liveBinding.openMarker);
	//the parser does not track namespaces, so it binds the content of an svg or mathml <template> too
	if (!(template instanceof HTMLTemplateElement)) {
		throw new Error(
			libraryMessage(
				"a <template> inside <svg> or <math> expects no ${...} in its content, since the browser builds a plain element there that has no content to fill. Move the hole outside of the <template>.",
			),
		);
	}
	const fragment = cloneTemplateFragment(liveBinding.staticBinding.content, null);
	mountInstance(fragment, values, liveBinding.staticBinding.content, {
		isTemplateContent: true,
	});
	removeMarkers(fragment);
	template.content.replaceChildren(fragment);
	liveBinding.lastValueHash = hash;
};

//the server already wrote the content from these values
export const hydrateTemplateContent = (
	liveBinding: TemplateContentLiveBinding,
	values: Array<unknown>,
): void => {
	liveBinding.lastValueHash = combinedPartsHash(liveBinding.staticBinding.valueIndices, values);
};
