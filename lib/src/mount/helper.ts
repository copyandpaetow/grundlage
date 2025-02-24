export const isIterable = (
  value: unknown
): value is Array<unknown> | Set<unknown> | Map<unknown, unknown> => {
  return Boolean(value?.[Symbol.iterator]);
};

export const remove = (start: Node, end: Node): DocumentFragment => {
  const deletedContent = new DocumentFragment();

  let current = start.nextSibling;
  while (current && current !== end) {
    const next = current.nextSibling;
    deletedContent.append(current);
    current = next;
  }

  return deletedContent;
};
