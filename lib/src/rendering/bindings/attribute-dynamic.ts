import { assertPrimitiveString, isPlainObject } from "../../utils/guards";
import { hashValue } from "../value-hashing";
import { claimHashChange } from "../compose";
import { applyAttributeValue } from "./attribute-write";
import { DynamicAttributeLiveBinding } from "./types";

const applyDesiredAttribute = (
	liveBinding: DynamicAttributeLiveBinding,
	name: string,
	desiredValue: unknown,
): void => {
	const { anchor: element, appliedAttributes, commitNumber } = liveBinding;
	const hash = hashValue(desiredValue);
	const previous = appliedAttributes.get(name);
	if (previous === undefined) {
		applyAttributeValue(element, name, desiredValue);
		appliedAttributes.set(name, {
			value: desiredValue,
			hash,
			lastSeenInCommit: commitNumber,
		});
		return;
	}
	previous.lastSeenInCommit = commitNumber;
	if (previous.hash === hash) return;
	applyAttributeValue(element, name, desiredValue, previous.value);
	previous.value = desiredValue;
	previous.hash = hash;
};

//keys and a lookup rather than destructured entries: each entry is an array the engine does not
//optimize away, 10 of them per commit on a five-name spread
const removeAttributesNotSeenInThisCommit = (
	liveBinding: DynamicAttributeLiveBinding,
): void => {
	const { anchor: element, appliedAttributes, commitNumber } = liveBinding;
	for (const name of appliedAttributes.keys()) {
		const previous = appliedAttributes.get(name)!;
		if (previous.lastSeenInCommit === commitNumber) continue;
		applyAttributeValue(element, name, null, previous.value);
		appliedAttributes.delete(name);
	}
};

export const commitDynamic = (
	liveBinding: DynamicAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	if (!claimHashChange(liveBinding, hashValue(value))) return;
	liveBinding.commitNumber++;
	if (Array.isArray(value))
		for (let index = 0; index < value.length; index++)
			applyDesiredAttribute(
				liveBinding,
				assertPrimitiveString(value[index]),
				"",
			);
	else if (isPlainObject(value))
		for (const name in value)
			applyDesiredAttribute(liveBinding, name, value[name]);
	else if (value)
		applyDesiredAttribute(liveBinding, assertPrimitiveString(value), "");
	removeAttributesNotSeenInThisCommit(liveBinding);
};
