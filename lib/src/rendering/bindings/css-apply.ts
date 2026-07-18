import { combinedPartsHash, composeParts } from "../compose";
import { RawContentLiveBinding } from "./types";

export const applyChangedCssGroups = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
	host: HTMLElement,
): void => {
	const groups = liveBinding.staticBinding.cssPlan!.groups;
	const { groupNames, previousGroupHashes } = liveBinding.cssState!;
	const hostStyle = host.style;
	for (let index = 0; index < groups.length; index++) {
		const groupHash = combinedPartsHash(groups[index].valueParts, values);
		if (groupHash === previousGroupHashes[index]) continue;
		previousGroupHashes[index] = groupHash;
		hostStyle.setProperty(
			groupNames[index],
			composeParts(groups[index].valueParts, values),
		);
	}
};

export const seedCssGroupHashes = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const groups = liveBinding.staticBinding.cssPlan!.groups;
	const { previousGroupHashes } = liveBinding.cssState!;
	for (let index = 0; index < groups.length; index++)
		previousGroupHashes[index] = combinedPartsHash(
			groups[index].valueParts,
			values,
		);
};

//the carrier's mount count stays monotonic: a live sibling mount still references the
//base names, so recycling this instance's ordinal would collide with it
export const releaseCssGroups = (
	liveBinding: RawContentLiveBinding,
	host: HTMLElement,
): void => {
	const { groupNames } = liveBinding.cssState!;
	const hostStyle = host.style;
	for (let index = 0; index < groupNames.length; index++)
		hostStyle.removeProperty(groupNames[index]);
};
