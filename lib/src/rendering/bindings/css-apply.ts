import { combinedPartsHash, composeParts } from "../compose";
import { RawContentLiveBinding } from "./types";

export const applyChangedCustomProperties = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
	host: HTMLElement,
): void => {
	const customProperties =
		liveBinding.staticBinding.compiledStyleSheet!.customProperties;
	const { customPropertyNames, previousValueHashes } =
		liveBinding.styleSheetState!;
	const hostStyle = host.style;
	for (let index = 0; index < customProperties.length; index++) {
		const valueHash = combinedPartsHash(
			customProperties[index].valueParts,
			values,
		);
		if (valueHash === previousValueHashes[index]) continue;
		previousValueHashes[index] = valueHash;
		hostStyle.setProperty(
			customPropertyNames[index],
			composeParts(customProperties[index].valueParts, values),
		);
	}
};

export const hydrateCustomPropertyHashes = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const customProperties =
		liveBinding.staticBinding.compiledStyleSheet!.customProperties;
	const { previousValueHashes } = liveBinding.styleSheetState!;
	for (let index = 0; index < customProperties.length; index++)
		previousValueHashes[index] = combinedPartsHash(
			customProperties[index].valueParts,
			values,
		);
};

export const releaseCustomProperties = (
	liveBinding: RawContentLiveBinding,
	host: HTMLElement,
): void => {
	const { customPropertyNames } = liveBinding.styleSheetState!;
	const hostStyle = host.style;
	for (let index = 0; index < customPropertyNames.length; index++)
		hostStyle.removeProperty(customPropertyNames[index]);
};
