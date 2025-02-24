import type { Context } from "../context";
import type { ValueOf } from "../context/signal";
import { isIterable, remove } from "./helper";
import {
  createMountPoint,
  defaultKeyFn,
  extractTemplateCallbacks,
  extractTemplateFunctionality,
  extractTemplateSlots,
  noop,
  shouldRerender,
  type MountPoint,
  type TemplateBus,
} from "./mount";
import { updateDOM } from "./update-dom";

const OPERATION_TYPES = {
  ADD: 0,
  DELETE: 1,
  MOVE: 2,
} as const;

type Operation = {
  type: ValueOf<typeof OPERATION_TYPES>;
  key: string;
  relatedKey: string;
  callback: () => unknown;
};

const calculateOperations = (
  list: Array<unknown>,
  keyFn = defaultKeyFn,
  previousResults: {
    keys: Set<string>;
    positions: Array<string>;
  }
) => {
  const operations: Array<Operation> = [];

  const currentPositions = list.map(keyFn);
  const currentKeys = new Set<string>(currentPositions);
  const maxSize = Math.max(
    currentPositions.length,
    previousResults.positions.length
  );

  let currentIndex = 0;
  let prevIndex = 0;
  for (let index = 0; index < maxSize; index++) {
    const currentKey = currentPositions[currentIndex];
    const prevKey = previousResults.positions[prevIndex];

    if (currentKey === prevKey) {
      currentIndex += 1;
      prevIndex += 1;
      continue;
    }

    if (!currentKey) {
      operations.push({
        type: OPERATION_TYPES.DELETE,
        key: prevKey,
        relatedKey: "",
        callback: noop,
      });
      prevIndex += 1;
      continue;
    }

    if (!previousResults.keys.has(currentKey)) {
      const result = list[currentIndex];
      operations.push({
        type: OPERATION_TYPES.ADD,
        key: currentKey,
        relatedKey: currentPositions[currentIndex - 1] ?? "",
        callback: () => result,
      });
      currentIndex += 1;
      continue;
    }

    if (!currentKeys.has(prevKey)) {
      operations.push({
        type: OPERATION_TYPES.DELETE,
        key: prevKey,
        relatedKey: "",
        callback: noop,
      });
      prevIndex += 1;
      continue;
    }

    const actualPrevKeyPosition = previousResults.positions.indexOf(
      currentKey,
      prevIndex
    );
    const currentPrevPosition = previousResults.positions[prevIndex];
    operations.push({
      type: OPERATION_TYPES.MOVE,
      key: currentKey,
      relatedKey: currentPrevPosition,
      callback: noop,
    });

    previousResults.positions[prevIndex] =
      previousResults.positions[actualPrevKeyPosition];
    previousResults.positions[actualPrevKeyPosition] = currentPrevPosition;

    currentIndex += 1;
    prevIndex += 1;
  }

  previousResults.keys = currentKeys;
  previousResults.positions = currentPositions;

  return operations;
};

export const mountList = (
  template: HTMLTemplateElement,
  templateBus: TemplateBus,
  context: Context
) => {
  const { signal } = context;

  const spacer = new Map<string, [Comment, Comment]>();
  const previousResults = {
    keys: new Set<string>(),
    positions: [],
  };

  const templateData = extractTemplateFunctionality(
    template,
    templateBus,
    context
  );

  const templateSlots = extractTemplateSlots(template);
  const [listStart] = createMountPoint(template, "list");
  const { beforeRender, afterRender } = extractTemplateCallbacks(
    template,
    context
  );

  signal.computed((isToplevelEffect) => {
    const parentResult = templateBus.activeValue();
    const list = isIterable(parentResult)
      ? Array.from(parentResult)
      : [parentResult];
    const operations = calculateOperations(
      list,
      templateBus.keyFn,
      previousResults
    );

    if (isToplevelEffect) {
      beforeRender(parentResult);
    }

    operations.forEach(({ type, key, relatedKey, callback }) => {
      switch (type) {
        case OPERATION_TYPES.ADD:
          const itemMountingPoint = [
            new Comment(`list-${key}-start`),
            new Comment(`list-${key}-end`),
          ] as MountPoint;

          spacer.set(key, itemMountingPoint);
          const prevSpacer = spacer.get(relatedKey)?.[1] ?? listStart;
          prevSpacer.after(...itemMountingPoint);
          const itemBus = { activeValue: callback, keyFn: templateBus.keyFn };

          const { status } = shouldRerender(
            templateSlots,
            templateData,
            itemBus,
            context
          );

          signal.computed(() => {
            const content = updateDOM(
              templateSlots[status()].cloneNode(true) as DocumentFragment,
              itemBus,
              context
            );

            requestAnimationFrame(() => {
              remove(...itemMountingPoint);
              itemMountingPoint[0].after(content);
            });
          });
          break;

        case OPERATION_TYPES.DELETE:
          const [start, end] = spacer.get(key);
          requestAnimationFrame(() => {
            remove(start.previousSibling, end.nextSibling);
            spacer.delete(key);
          });
          break;

        case OPERATION_TYPES.MOVE:
          const [fromStart, fromEnd] = spacer.get(relatedKey);
          const [toStart, toEnd] = spacer.get(key);

          requestAnimationFrame(() => {
            const fromContent = remove(fromStart, fromEnd);
            const toContent = remove(toStart, toEnd);

            fromStart.after(toContent);
            toStart.after(fromContent);
          });
          spacer.set(relatedKey, [toStart, toEnd]);
          spacer.set(key, [fromStart, fromEnd]);

          break;

        default:
          console.warn("operation not recognized");
          break;
      }
    });

    if (isToplevelEffect) {
      requestAnimationFrame(() => {
        afterRender(parentResult);
      });
    }
  });
};
