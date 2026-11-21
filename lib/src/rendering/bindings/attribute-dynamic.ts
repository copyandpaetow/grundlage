import { stringifyPrimitive, isPlainObject } from "../../utils/guards";
import { hashValue } from "../value-hashing";
import {
	applyAttributeValue,
	applyLiveState,
	applyLiveStateDefault,
	ensureKeptByCopies,
	isLiveStatePropertyOf,
} from "./attribute-apply";
import { DynamicAttributeLiveBinding, TreeState } from "./types";
import { assertDuringDevelopment } from "../../utils/diagnostics";

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
		for (let index = 0; index < value.length; index++) {
			if (String(value[index]) === name) return true;
		}
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
	for (const name of liveBinding.appliedAttributes.keys()) {
		if (valueStillHoldsAttribute(value, name)) continue;
		const appliedEntry = liveBinding.appliedAttributes.get(name);
		assertDuringDevelopment(
			appliedEntry !== undefined,
			"a key read while iterating the map has an entry",
		);
		applyAttributeValue(liveBinding.anchor, name, undefined, appliedEntry.value);
		liveBinding.appliedAttributes.delete(name);
	}
};

export const commitDynamic = (
	liveBinding: DynamicAttributeLiveBinding,
	values: Array<unknown>,
	treeState: TreeState,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const hash = hashValue(value);
	if (hash === liveBinding.lastValueHash) return;
	liveBinding.lastValueHash = hash;
	const element = liveBinding.anchor;
	const names = attributeNamesOf(value);
	for (let index = 0; index < names.length; index++) {
		const name = stringifyPrimitive(names[index]);
		const desiredValue = isPlainObject(value) ? value[name] : "";
		const desiredValueHash = hashValue(desiredValue);
		const appliedEntry = liveBinding.appliedAttributes.get(name);
		if (appliedEntry?.hash === desiredValueHash) continue;
		if (treeState.isTemplateContent) ensureKeptByCopies(element, name, desiredValue);
		const isLiveState = isLiveStatePropertyOf(element, name);
		if (isLiveState && appliedEntry !== undefined) applyLiveState(element, name, desiredValue);
		else if (isLiveState) applyLiveStateDefault(element, name, desiredValue);
		else applyAttributeValue(element, name, desiredValue, appliedEntry?.value);
		liveBinding.appliedAttributes.set(name, {
			value: desiredValue,
			hash: desiredValueHash,
		});
	}
	removeDroppedAttributes(liveBinding, value);
};
