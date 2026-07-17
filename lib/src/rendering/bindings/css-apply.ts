import { combinedPartsHash, composeParts } from "../compose";
import { RawContentLiveBinding } from "./types";

export const applyChangedCssGroups = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const groups = liveBinding.staticBinding.cssPlan!.groups;
	const groupNames = liveBinding.groupNames!;
	const previousGroupHashes = liveBinding.previousGroupHashes!;
	const hostStyle = liveBinding.carrier.host.style;
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
	const previousGroupHashes = liveBinding.previousGroupHashes!;
	for (let index = 0; index < groups.length; index++)
		previousGroupHashes[index] = combinedPartsHash(
			groups[index].valueParts,
			values,
		);
};
