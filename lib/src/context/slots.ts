import type { Reactivity, SignalGetter } from "./signal";

export const getSlotContent = (
  root: Element | ShadowRoot,
  signal: Reactivity
) => {
  const slotSignals = new WeakMap<HTMLSlotElement, SignalGetter<Node[]>>();

  const getSlotSignal = (slot: HTMLSlotElement) => {
    let active = false;
    let initial = true;
    const [slotContent, setSlotContent] = signal.create(slot.assignedNodes());

    const onSlotChange = () => {
      if (active) {
        return;
      }
      if (initial) {
        initial = false;
        return;
      }
      active = true;
      setSlotContent(slot.assignedNodes());
      requestAnimationFrame(() => {
        active = false;
      });
    };

    slot.addEventListener("slotchange", onSlotChange);

    signal.onCleanup(() => {
      slot.removeEventListener("slotchange", onSlotChange);
    });

    return slotContent;
  };

  return (name = "") => {
    const selector = name ? `slot[name='${name}']` : "slot:not([name])";
    const slot = root.querySelector(selector) as HTMLSlotElement;
    if (!slot) {
      console.error("no slot with that name exists, returning empty signal");
      return (() => []) as SignalGetter<Node[]>;
    }

    if (slotSignals.has(slot)) {
      return slotSignals.get(slot) as SignalGetter<Node[]>;
    }
    const currentSlotSignal = getSlotSignal(slot);
    slotSignals.set(slot, currentSlotSignal);
    return currentSlotSignal;
  };
};
