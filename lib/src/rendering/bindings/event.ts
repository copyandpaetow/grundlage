import { targetElement } from "../dom";
import { EventLiveBinding } from "./types";

export const commitEvent = (
	liveBinding: EventLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const nextHandler =
		typeof value === "function" ? (value as EventListener) : null;
	if (nextHandler === liveBinding.eventHandler) return;
	const element = targetElement(liveBinding);
	const { eventType } = liveBinding.staticBinding;
	if (liveBinding.eventHandler !== null)
		element.removeEventListener(eventType, liveBinding.eventHandler);
	if (nextHandler !== null) element.addEventListener(eventType, nextHandler);
	liveBinding.eventHandler = nextHandler;
};

export const reapplyOnSwap = (
	liveBinding: EventLiveBinding,
	element: Element,
): void => {
	if (liveBinding.eventHandler !== null)
		element.addEventListener(
			liveBinding.staticBinding.eventType,
			liveBinding.eventHandler,
		);
};
