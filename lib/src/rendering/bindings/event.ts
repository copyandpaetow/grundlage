import { targetElement } from "../dom";
import { EventLiveBinding } from "./types";

export const commitEvent = (
	liveBinding: EventLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const nextHandler =
		typeof value === "function" ? (value as EventListener) : null;
	const element = targetElement(liveBinding);
	const { eventType } = liveBinding.staticBinding;
	if (liveBinding.eventHandler !== null)
		element.removeEventListener(eventType, liveBinding.eventHandler);
	if (nextHandler !== null) element.addEventListener(eventType, nextHandler);
	liveBinding.eventHandler = nextHandler;
};
