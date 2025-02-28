import {
  createStyleStub,
  cssKey,
  isNestedStyleRender,
  isStatic,
  isUsedAsClassIdentifier,
  mergeMaps,
} from "./helper";

export type CssParsingResult = {
  template: string;
  values: Map<string, unknown>;
  key: typeof cssKey;
  name: string;
};

const nestedRender = (value: unknown, result: CssParsingResult): string => {
  if (isStatic(value)) {
    return value.toString();
  }

  if (Array.isArray(value) || value instanceof Set) {
    return Array.from(value)
      .map((value) => nestedRender(value, result))
      .join(" ");
  }

  if (isNestedStyleRender(value)) {
    mergeMaps(value.values, result.values);
    if (isUsedAsClassIdentifier(result)) {
      result.values.set(value.name, value.template);
      return value.name;
    }

    return value.template;
  }

  if (typeof value === "function") {
    const stub = createStyleStub();
    result.values.set(stub, value);

    return `var(--${stub}, ${value()})`;
  }

  if (typeof value === "function") {
    return nestedRender(value(), result);
  }

  if (value) {
    return value.toString();
  }
  return "";
};

//TODO: it might be worth to check if we are a value or not
//TODO: we could also try to determine if we are inside of a class or not
//? we could also expose the name and let the user do whatever they want with this
//TODO: The render objects should have the same shape
export const css = (
  tokens: TemplateStringsArray,
  ...dynamicValues: Array<unknown>
): CssParsingResult => {
  const result: CssParsingResult = {
    template: tokens[0],
    values: new Map<string, unknown>(),
    key: cssKey,
    name: createStyleStub(),
  };

  tokens.slice(1).forEach((currentToken, index) => {
    const currentValue = dynamicValues[index];
    result.template += `${nestedRender(currentValue, result)}${currentToken}`;
  });

  return result;
};
