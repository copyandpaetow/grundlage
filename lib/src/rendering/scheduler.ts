import { pullProducer, reportProducerError, resolveSettle, Producer } from "./producer";

/*
the Scheduler is pure batching state — a flush promise and a dirty bit. it holds no reference to
Producer or the Painter; runFlushLoop takes Producer by parameter. the settle signal comes back up
through pullProducer's returned promise, never a back-edge, so the dependency is the acyclic line
Scheduler → Producer → Painter.

the coalescing gate (ride an open flushPromise; flag a mid-flight call dirty) is NOT here — it lives
inline at the single call site, the element's update(). this module owns the loop; the element owns
the decision to start it.

this encodes the ADR-0003 contract: update() resolves once this call's DOM has landed, coalescing
with any concurrent update, across sync and async renders.
*/

export interface Scheduler {
	flushPromise: Promise<void> | null; //non-null ⇔ a batch is open
	dirty: boolean; //a mid-flight update() → exactly one reflush with a fresh pull
}

export const createScheduler = (): Scheduler => ({ flushPromise: null, dirty: false });

//release: clear the batch state so a stale reflush can't fire after disconnect. the caller resolves
//any pending settle on the Producer side
export const resetScheduler = (scheduler: Scheduler): void => {
	scheduler.flushPromise = null;
	scheduler.dirty = false;
};

//run one batch: open the await-null window, then re-pull until no update arrived mid-flight. update()
//opens this once per batch and parks the result on scheduler.flushPromise. resolves once the DOM has landed
export const runFlushLoop = async (scheduler: Scheduler, producer: Producer): Promise<void> => {
	await null; //batching window: a synchronous burst of update() calls coalesces onto this batch
	do {
		scheduler.dirty = false;
		try {
			await pullProducer(producer); //resolves when this dispatch's DOM lands (sync or async)
		} catch (error) {
			//a render-fn / static threw synchronously inside pullProducer. bubble it, then unstick the
			//await so the loop can settle (the throw escaped before pullProducer resolved)
			reportProducerError(producer, error as Error);
			resolveSettle(producer);
		}
	} while (scheduler.dirty);
	scheduler.flushPromise = null;
};
