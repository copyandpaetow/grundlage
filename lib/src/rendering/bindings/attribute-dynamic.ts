import { stringifyPrimitive, isPlainObject } from "../../utils/guards";
import { hashValue } from "../value-hashing";
import {
	applyAttributeValue,
	applyLiveState,
	applyLiveStateDefault,
	isLiveStatePropertyOf,
} from "./attribute-apply";
import { DynamicAttributeLiveBinding } from "./types";
import { assertDuringDevelopment } from "../../utils/diagnostics";

//TEMP sweep 9.5: "seen" is derived from the value instead of stamped per entry; keep it only if
//the two benchmark pages show no change (+6-7% per spread commit in the direct measurement)
const NO_ATTRIBUTE_NAMES: ReadonlyArray<unknown> = [];

const attributeNamesOf = (value: unknown): ReadonlyArray<unknown> => {
	if (Array.isArray(value)) return value;
	if (isPlainObject(value)) return Object.keys(value);
	if (value) return [value];
	return NO_ATTRIBUTE_NAMES;
};

//names are compared as spelled: an array or scalar value may hold numbers, booleans or bigints
const valueStillHoldsAttribute = (value: unknown, name: string): boolean => {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++)
			if (String(value[index]) === name) return true;
		return false;
	}
	if (isPlainObject(value)) return Object.hasOwn(value, name);
	return Boolean(value) && String(value) === name;
};

//keys and a lookup rather than destructured entries: each entry is an array the engine does not
//optimize away, 10 of them per commit on a five-name spread
const removeDroppedAttributes = (
	liveBinding: DynamicAttributeLiveBinding,
	value: unknown,
): void => {
	const { anchor: element, appliedAttributes } = liveBinding;
	for (const name of appliedAttributes.keys()) {
		if (valueStillHoldsAttribute(value, name)) continue;
		const appliedEntry = appliedAttributes.get(name);
		assertDuringDevelopment(
			appliedEntry !== undefined,
			"a key read while iterating the map has an entry",
		);
		applyAttributeValue(element, name, null, appliedEntry.value);
		appliedAttributes.delete(name);
	}
};

export const commitDynamic = (
	liveBinding: DynamicAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const hash = hashValue(value);
	if (hash === liveBinding.lastValueHash) return;
	liveBinding.lastValueHash = hash;
	const { anchor: element, appliedAttributes } = liveBinding;
	const names = attributeNamesOf(value);
	for (let index = 0; index < names.length; index++) {
		const name = stringifyPrimitive(names[index]);
		const desiredValue = isPlainObject(value) ? value[name] : "";
		const desiredValueHash = hashValue(desiredValue);
		const appliedEntry = appliedAttributes.get(name);
		if (appliedEntry?.hash === desiredValueHash) continue;
		const isLiveState = isLiveStatePropertyOf(element, name);
		if (isLiveState && appliedEntry !== undefined)
			applyLiveState(element, name, desiredValue);
		else if (isLiveState) applyLiveStateDefault(element, name, desiredValue);
		else applyAttributeValue(element, name, desiredValue, appliedEntry?.value);
		appliedAttributes.set(name, {
			value: desiredValue,
			hash: desiredValueHash,
		});
	}
	removeDroppedAttributes(liveBinding, value);
};
