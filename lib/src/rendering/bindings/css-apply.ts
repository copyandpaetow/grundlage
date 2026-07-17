import { CssValueGroup } from "../../parser/types";
import { combinedPartsHash, composeParts } from "../compose";

export const applyChangedCssGroups = (
	hostStyle: CSSStyleDeclaration,
	groups: Array<CssValueGroup>,
	groupNames: Array<string>,
	previousGroupHashes: Array<number>,
	values: Array<unknown>,
): void => {
	for (let index = 0; index < groups.length; index++) {
		const group = groups[index];
		const groupHash = combinedPartsHash(group.valueParts, values);
		if (groupHash === previousGroupHashes[index]) continue;
		previousGroupHashes[index] = groupHash;
		hostStyle.setProperty(
			groupNames[index],
			composeParts(group.valueParts, values),
		);
	}
};

export const seedCssGroupHashes = (
	groups: Array<CssValueGroup>,
	previousGroupHashes: Array<number>,
	values: Array<unknown>,
): void => {
	for (let index = 0; index < groups.length; index++)
		previousGroupHashes[index] = combinedPartsHash(
			groups[index].valueParts,
			values,
		);
};
