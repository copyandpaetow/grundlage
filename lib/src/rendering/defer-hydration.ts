import { isServer } from "../utils/guards";
import { ValueOf } from "../utils/types";
import { ATTRIBUTE_MODE, DEFER_HYDRATION_ATTRIBUTE } from "./constants";

//a property-channel value reaches the child only through the parent's binding, so the server
//marks that child to keep it from hydrating against markup rendered with values it no longer has
export const markDeferredHydration = (
	element: Element,
	valueChannel: ValueOf<typeof ATTRIBUTE_MODE>,
): void => {
	const isLostFromServerMarkup =
		isServer() && valueChannel === ATTRIBUTE_MODE.PROPERTY;
	if (isLostFromServerMarkup)
		element.setAttribute(DEFER_HYDRATION_ATTRIBUTE, "");
};

//this root only: a released child releases its own children from its own paint, one level per
//synchronous step, and a nested shadow root is not reachable from here anyway
export const releaseDeferredChildren = (shadowRoot: ShadowRoot): void => {
	const deferred = shadowRoot.querySelectorAll(
		`[${DEFER_HYDRATION_ATTRIBUTE}]`,
	);
	for (let index = 0; index < deferred.length; index++)
		deferred[index].removeAttribute(DEFER_HYDRATION_ATTRIBUTE);
};
