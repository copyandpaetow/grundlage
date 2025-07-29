import type { Context } from "../context";
import type { SignalGetter } from "../context/signal";

export const updateStyle = (
  styleElement: HTMLStyleElement,
  context: Context
) => {
  const { signal, values } = context;
  styleElement.getAttributeNames().forEach((key) => {
    if (!values.has(key)) {
      return;
    }
    styleElement.removeAttribute(key);
    //@ts-expect-error
    const root = styleElement.getRootNode().host as HTMLElement;
    const value = values.get(key) as SignalGetter<string>;

    signal.computed(() => {
      const result = value();
      root.style.setProperty(`--${key}`, result);
      signal.onCleanup(() => root.style.removeProperty(`--${key}`));
    });
  });
};
