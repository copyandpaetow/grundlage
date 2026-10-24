import { BaseComponent } from "../types";
import {
	isDevelopmentBuild,
	warnDuringDevelopment,
} from "../utils/diagnostics";
import * as PROP_KIND from "./prop-kind";
import { issueMessagesOf, NormalizedSchema, Prop } from "./schema";

export type PropValues = Record<string, unknown>;

export const createComponentProps = (
	props: NormalizedSchema,
	host: BaseComponent,
): PropValues => {
	const componentProps: PropValues = { host };
	for (const prop of props.values())
		componentProps[prop.propName] = prop.resolve(undefined);
	return componentProps;
};

export const claimPropValueChange = (
	values: PropValues,
	prop: Prop,
	incoming: unknown,
): boolean => {
	//an attribute's removal arrives as null, so only a property prop can hold null as a value
	const isAbsent =
		incoming === undefined ||
		(incoming === null && prop.kind !== PROP_KIND.PROPERTY);
	if (isAbsent && prop.isRequired) {
		warnDuringDevelopment(
			`prop "${prop.propName}" is required and cannot become ${String(incoming)}, so the previous value stays.`,
		);
		return false;
	}
	const next = prop.resolve(isAbsent ? undefined : incoming);

	const isRefused = next === undefined && !isAbsent;
	if (isRefused) {
		const reason =
			prop.standardSchema !== null && isDevelopmentBuild
				? issueMessagesOf(prop.standardSchema, incoming)
				: "its parser returned undefined";
		warnDuringDevelopment(
			`prop "${prop.propName}" refused a ${typeof incoming} (${reason}), so the previous value stays.`,
		);
		return false;
	}

	const cannotChangeBehindReference =
		next === null || (typeof next !== "object" && typeof next !== "function");
	const isUnchanged =
		Object.is(values[prop.propName], next) && cannotChangeBehindReference;
	if (isUnchanged) return false;

	values[prop.propName] = next;
	return true;
};

export const attributeSpellingOf = (
	prop: Prop,
	value: unknown,
): string | null => {
	switch (typeof value) {
		case "string":
			return value;
		case "number":
		case "bigint":
			return String(value);
		case "boolean":
			if (value) return "";
			return prop.isTrueWhenAbsent ? "false" : null;
		default:
			return null;
	}
};

export const recoverPreUpgradeAssignments = (
	element: HTMLElement,
	props: NormalizedSchema,
): void => {
	//Element has no index signature; props are read and written by their runtime name
	const record = element as unknown as Record<string, unknown>;
	for (const prop of props.values()) {
		if (!Object.hasOwn(record, prop.propName)) continue;
		//the binding also wrote the attribute for CSS before definition, and a property prop would never
		//update it again
		if (prop.kind === PROP_KIND.PROPERTY)
			element.removeAttribute(prop.propName.toLowerCase());
		const assigned = record[prop.propName];
		delete record[prop.propName];
		record[prop.propName] = assigned;
	}
};
