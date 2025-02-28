import {
  isStatic,
  mergeMaps,
  createStub,
  isNestedRender,
  renderKey,
  isInsideOfTag,
  isNestedStyleRender,
} from "./helper";

const markElement = (result: ParsingResult) => {
  const template = result.template;
  const lastOpeningBracket = template.lastIndexOf("<");

  if (template.indexOf(" data-update ", lastOpeningBracket) !== -1) {
    return;
  }

  const endOfElementTag = template.indexOf(" ", lastOpeningBracket);
  const untilAttributesStart = template.slice(0, endOfElementTag);
  const afterAttributesStart = template.slice(endOfElementTag + 1);

  result.template = `${untilAttributesStart} data-update ${afterAttributesStart}`;
};

const expandAttributes = (value: unknown, result: ParsingResult): unknown => {
  if (isStatic(value)) {
    return value;
  }

  if (isNestedStyleRender(value)) {
    mergeMaps(value.values, result.values);
    result.values.set(value.name, value.template);
    return value.name;
  }

  if (Array.isArray(value) || value instanceof Set) {
    return Array.from(value)
      .map((value) => expandAttributes(value, result))
      .join(" ");
  }

  if (value && typeof value === "object") {
    const iterator =
      value instanceof Map ? Array.from(value) : Object.entries(value);
    return iterator
      .map(
        ([key, nestedValue]) =>
          `${key}=${expandAttributes(nestedValue, result)} `
      )
      .join(" ");
  }

  markElement(result);
  const stub = createStub();
  result.values.set(stub, value);
  return stub;
};

const expandContent = (value: unknown, result: ParsingResult) => {
  if (isStatic(value)) {
    return value;
  }

  if (isNestedRender(value)) {
    mergeMaps(value.values, result.values);
    return value.template;
  }

  if (isNestedStyleRender(value)) {
    mergeMaps(value.values, result.values);
    result.values.set(value.name, value.template);
    return `<style ${Array.from(value.values.keys()).join(" ")}>${value.template}</style>`;
  }

  const stub = createStub();
  result.values.set(stub, value);
  return `<span data-replace=${stub}></span>`;
};

export type ParsingResult = {
  template: string;
  values: Map<string, unknown>;
  name: string;
  key: typeof renderKey;
};

export const html = (
  tokens: TemplateStringsArray,
  ...dynamicValues: Array<unknown>
): ParsingResult => {
  const result: ParsingResult = {
    template: tokens[0],
    values: new Map<string, unknown>(),
    key: renderKey,
    name: "",
  };

  tokens.slice(1).forEach((currentToken, index) => {
    const curerntValue = dynamicValues[index];

    const stubbingresult = isInsideOfTag(result.template)
      ? expandAttributes(curerntValue, result)
      : expandContent(curerntValue, result);

    result.template += `${stubbingresult}${currentToken}`;
  });

  return result;
};
