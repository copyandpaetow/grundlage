import { BaseComponent } from "../types";

export type Instance = {
	current: BaseComponent | null;
};

export const instance: Instance = {
	current: null,
};

export const useState = <Value extends unknown>(
	name: string,
	initialValue: Value,
	options?: {}
) => {
	if (!instance.current) {
		throw new Error("instance is not defined");
	}

	const currentInstance = instance.current;
	const camelCaseName = name[0].toUpperCase() + name.slice(1);
	const lowerCaseName = name.toLowerCase();
	const currentValue = currentInstance.hasState(name)
		? currentInstance.getState(name)
		: currentInstance.setState(name, initialValue);

	return {
		[lowerCaseName]: currentValue,
		[`set${camelCaseName}`]: <Value>(newValue: Value) =>
			currentInstance.setState(name, newValue),
	};
};
