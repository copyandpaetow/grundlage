import {
  type Reactivity,
  type SignalGetter,
  createSignalReactivity,
} from "./signal";
import { getSlotContent } from "./slots";

export type Context = {
  signal: Reactivity;
  mountCallbacks: Set<VoidFunction>;
  unMountCallbacks: Set<VoidFunction>;
  dispose: VoidFunction;
  values: Map<string, unknown>;
};

//TODO: readd plugin functionality

export type UserContext = Pick<Context, "signal"> & {
  lifecyle: {
    onMount: (callback: VoidFunction) => void;
    onUnmount: (callback: VoidFunction) => void;
  };
  elements: {
    shadowRoot: () => ShadowRoot;
    slots: (name?: string) => SignalGetter<Node[]>;
  };
};

export const createUserContext = (
  shadowRoot: ShadowRoot,
  { mountCallbacks, unMountCallbacks, signal }: Context
): UserContext => {
  return {
    signal,
    lifecyle: {
      onMount: (callback) => {
        mountCallbacks.add(callback);
      },
      onUnmount: (callback) => {
        unMountCallbacks.add(callback);
      },
    },
    elements: {
      shadowRoot: () => shadowRoot,
      slots: getSlotContent(shadowRoot, signal),
    },
  };
};

export const createContext = (): Context => {
  const signal = createSignalReactivity();
  const mountCallbacks = new Set<VoidFunction>();
  const unMountCallbacks = new Set<VoidFunction>();
  const values = new Map<string, unknown>();

  return {
    signal,
    mountCallbacks,
    unMountCallbacks,
    values,
    dispose() {
      signal.dispose();
      mountCallbacks.clear();
      unMountCallbacks.clear();
    },
  };
};
