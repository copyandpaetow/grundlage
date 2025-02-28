import type { CssParsingResult } from "./css";
import type { ParsingResult } from "./html";

export const renderKey = Symbol("render");

export const isInsideOfTag = (template: string) => {
  const lastOpeningBracket = template.lastIndexOf("<");
  const lastClosingBracket = template.lastIndexOf(">");
  const hasNoClosingBracket = lastClosingBracket === -1;
  const hasNoOpeningBracket = lastOpeningBracket === -1;

  if (hasNoOpeningBracket) {
    return false;
  }

  return hasNoClosingBracket || lastClosingBracket < lastOpeningBracket;
};

const cases = ["string", "number", "bigint", "boolean", "symbol"];

export const isStatic = (
  value: unknown
): value is string | number | boolean | bigint | symbol =>
  cases.includes(typeof value);

//TODO: maybe some of these can be condensed
export const isNestedRender = (
  nextValue: unknown
): nextValue is ParsingResult => {
  //@ts-expect-error
  return typeof nextValue === "object" && nextValue?.key === renderKey;
};

export const createStub = () => {
  return `__${(Math.random() * 100000).toFixed()}__`;
};

export const mergeMaps = (
  from: Map<unknown, unknown>,
  to: Map<unknown, unknown>
) => {
  from.forEach((nestedValue, nestedKey) => to.set(nestedKey, nestedValue));
  return to;
};

export const cssKey = Symbol("css");

export const createStyleStub = () => {
  return `css-${(Math.random() * 100000).toFixed()}`;
};

export const isUsedAsClassIdentifier = (node: CssParsingResult) => {
  return node.template.at(-1) === ".";
};

export const isNestedStyleRender = (
  nextValue: unknown
): nextValue is CssParsingResult => {
  //@ts-expect-error
  return typeof nextValue === "object" && nextValue?.key === cssKey;
};
