import { BaseComponent } from "../types";
import { NormalizedSchema, Prop } from "./schema";

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

const cannotChangeBehindItsReference = (value: unknown): boolean =>
	value === null || (typeof value !== "object" && typeof value !== "function");

export const writeProp = (
	values: PropValues,
	prop: Prop,
	incoming: unknown,
): boolean => {
	const isAbsent = incoming === undefined || incoming === null;
	const next = prop.resolve(isAbsent ? undefined : incoming);

	if (next === undefined && !isAbsent) {
		console.warn(
			`grundlage: prop "${prop.propName}" refused a ${typeof incoming}: its function returned undefined, so the previous value stays.`,
		);
		return false;
	}

	const isUnchanged =
		Object.is(values[prop.propName], next) &&
		cannotChangeBehindItsReference(next);
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
			return prop.absenceReadsTrue ? "false" : null;
		default:
			return null;
	}
};

export const recoverPreUpgradeAssignments = (
	element: HTMLElement,
	props: NormalizedSchema,
): void => {
	const record = element as unknown as Record<string, unknown>;
	for (const prop of props.values()) {
		if (!Object.hasOwn(record, prop.propName)) continue;
		const assigned = record[prop.propName];
		delete record[prop.propName];
		record[prop.propName] = assigned;
	}
};
