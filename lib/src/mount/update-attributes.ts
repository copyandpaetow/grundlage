import type { Context } from "../context";
import type { TemplateBus } from "./mount";
import type { SignalGetter } from "../context/signal";

const extractSpecial = (testString: string) => {
  const results = [];
  let startIndex = testString.indexOf("__");
  while (startIndex !== -1) {
    const endIndex = testString.indexOf("__", startIndex + 2);
    if (endIndex === -1) break;
    results.push(testString.slice(startIndex, endIndex + 2));
    startIndex = testString.indexOf("__", endIndex + 2);
  }
  return results;
};

export const updateAttributes = (
  stubbedElement: HTMLElement,
  templateBus: TemplateBus,
  context: Context
) => {
  const { signal, values } = context;

  stubbedElement.removeAttribute("data-update");
  stubbedElement.getAttributeNames().forEach((attributeName) => {
    const attributeSub = stubbedElement.getAttribute(attributeName);
    const attributeValue = values.get(attributeSub) as
      | SignalGetter<string>
      | ((activeValue: unknown) => string);

    if (!attributeName.startsWith("__") && !attributeSub.includes("__")) {
      return;
    }

    if (attributeName === "ref") {
      stubbedElement.removeAttribute(attributeName);
      attributeValue(stubbedElement);
      return;
    }

    if (attributeName.startsWith("on")) {
      stubbedElement.removeAttribute(attributeName);
      const name = attributeName.slice(2);
      stubbedElement.addEventListener(name, attributeValue as EventListener);
      signal.onCleanup(() =>
        stubbedElement.removeEventListener(
          name,
          attributeValue as EventListener
        )
      );
      return;
    }

    if (attributeName === "class") {
      extractSpecial(attributeSub).forEach((stubbedClass) => {
        const value = values.get(stubbedClass) as
          | SignalGetter<string>
          | ((activeValue: unknown) => string);
        let current = stubbedClass;
        signal.computed(() => {
          const result = value(templateBus.activeValue());
          stubbedElement.classList.replace(current, result);
          current = result;
        });
      });
      return;
    }

    if (stubbedElement.tagName.includes("-")) {
      if (stubbedElement.hasOwnProperty("setProperty")) {
        //@ts-expect-error this is for nested web-components
        stubbedElement.setProperty(attributeName, attributeValue);
      } else {
        stubbedElement[attributeName] = attributeValue;
      }
      return;
    }

    if (typeof attributeValue === "function") {
      stubbedElement.removeAttribute(attributeName);
      signal.computed(() => {
        const result = attributeValue(templateBus.activeValue());
        stubbedElement.setAttribute(
          attributeName || result,
          attributeName ? result : ""
        );
      });
    }

    //TODO: we need to handle complex non-class values
  });
};
