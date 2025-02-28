import type { Context } from "../context";
import { createMountPoint, type TemplateBus } from "./mount";
import { remove } from "./helper";
import type { SignalGetter } from "../context/signal";

export const updateContent = (
  stubbedElement: Element,
  templateBus: TemplateBus,
  context: Context
) => {
  const { signal, values } = context;

  const value = values.get(stubbedElement.getAttribute("data-replace")!) as
    | SignalGetter<string>
    | ((activeValue: unknown) => string);
  const [start, end] = createMountPoint(stubbedElement, "content");

  signal.computed((isToplevelEffect) => {
    const currentResult = value(templateBus.activeValue());
    const asNode = document.createTextNode(currentResult);

    if (isToplevelEffect) {
      requestAnimationFrame(() => {
        remove(start, end);
        start.after(asNode);
      });
    } else {
      remove(start, end);
      start.after(asNode);
    }
  });
};
