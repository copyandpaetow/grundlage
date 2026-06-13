import { describe, expect, test } from "vitest";
import { BaseComponent } from "../types";
import { createPainter } from "./painter";
import { clientCommit, createProducer, Producer, startRoot } from "./producer";
import { createScheduler, resetScheduler, runFlushLoop, Scheduler } from "./scheduler";

//the element's update() inlines this coalescing gate (it is no longer a source function); we mirror
//it here verbatim so the gate + runFlushLoop stay unit-tested together, DOM-free. the element-level
//behaviour is also pinned by the update-scheduling.browser oracle
const openFlush = (scheduler: Scheduler, producer: Producer): Promise<void> => {
	if (scheduler.flushPromise !== null) {
		scheduler.dirty = true;
		return scheduler.flushPromise;
	}
	return (scheduler.flushPromise = runFlushLoop(scheduler, producer));
};

/*
the scheduler's ADR-0003 timing contract (C2–C6), tested WITHOUT a DOM. the trick: drive the real
Producer, but with generators that yield only Promises / plain values and never a template — so the
Painter's host is never dereferenced and `paint` never runs. that isolates the async coordination
(when does the flush promise resolve relative to settle, how do concurrent calls coalesce, how does
a mid-flight update reflush) from the DOM commit, which is the Painter's concern and tested there.
*/

interface Deferred {
	promise: Promise<unknown>;
	resolve: (value?: unknown) => void;
}
const deferred = (): Deferred => {
	let resolve!: (value?: unknown) => void;
	const promise = new Promise((res) => {
		resolve = res as (value?: unknown) => void;
	});
	return { promise, resolve };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

//a Producer whose "current" is a generator that parks on a gate and completes when the gate resolves
//— completion (not a paint) is what fires settle. each spawn pushes a fresh gate, so resolving
//gates[i] settles generation i. no template is ever yielded, so this stays DOM-free
const makeGatedProducer = () => {
	const gates: Deferred[] = [];
	const inner = function* () {
		const gate = deferred();
		gates.push(gate);
		yield gate.promise; //parks here; resolving the gate drives the generator to completion → settle
	};
	const painter = createPainter({} as BaseComponent, false); //host never touched (no paint)
	const producer = createProducer(painter, clientCommit);
	startRoot(producer, function* () {
		yield inner; //installs the generator current; parks generation 0 at gates[0]
	});
	return { producer, gates };
};

const latestGate = (gates: Deferred[]) => gates[gates.length - 1];

describe("scheduler — ADR-0003 timing contract", () => {
	test("C2: the flush promise resolves only after the async render settles", async () => {
		const { producer, gates } = makeGatedProducer();
		const scheduler = createScheduler();

		let resolved = false;
		const flush = openFlush(scheduler, producer).then(() => {
			resolved = true;
		});

		await tick(); //await-null window + the pull: supersedes gen0, spawns gen1, parks it
		expect(gates).toHaveLength(2); //gen0 (start) + gen1 (this flush)
		expect(resolved).toBe(false); //gen1 still parked — the DOM hasn't "landed" yet

		latestGate(gates).resolve();
		await flush;
		expect(resolved).toBe(true); //settles only once the in-flight render completed
	});

	test("C3: concurrent update() calls coalesce onto one promise", async () => {
		const { producer, gates } = makeGatedProducer();
		const scheduler = createScheduler();

		const a = openFlush(scheduler, producer);
		const b = openFlush(scheduler, producer);
		expect(b).toBe(a); //the second call rides the open batch, returns the same promise

		await tick();
		latestGate(gates).resolve();
		await a;
		await b;
	});

	test("C4: a mid-flight update() triggers exactly one reflush with a fresh pull", async () => {
		const { producer, gates } = makeGatedProducer();
		const scheduler = createScheduler();

		const flush = openFlush(scheduler, producer);
		await tick(); //pull #1 in flight (gen1 parked)
		expect(gates).toHaveLength(2);

		openFlush(scheduler, producer); //arrives mid-flight → sets dirty, does NOT restart now
		latestGate(gates).resolve(); //gen1 settles → dirty seen → reflush
		await tick();
		expect(gates).toHaveLength(3); //pull #2 spawned gen2; exactly one reflush

		latestGate(gates).resolve(); //gen2 settles → dirty clear → loop exits
		await flush;
		expect(scheduler.flushPromise).toBeNull(); //batch closed
	});

	test("C5: a pull supersedes the in-flight generation before spawning the next", async () => {
		const { producer, gates } = makeGatedProducer();
		const scheduler = createScheduler();

		const supersededChild = producer.currentTask!; //generation 0, parked at gates[0]
		const flush = openFlush(scheduler, producer);
		await tick(); //pull cancels gen0, spawns gen1

		expect(supersededChild.finished).toBe(true); //superseded, its late gate resolution is contained
		gates[0].resolve(); //resolving the dead generation's gate must not settle the flush
		await tick();
		expect(scheduler.flushPromise).not.toBeNull(); //still open — gen1 hasn't settled

		latestGate(gates).resolve();
		await flush;
		expect(scheduler.flushPromise).toBeNull();
	});

	test("C6: a static current (no recipe) settles immediately with no spawn", async () => {
		const painter = createPainter({} as BaseComponent, false);
		const producer: Producer = createProducer(painter, clientCommit); //createCurrent null, no currentTask
		const scheduler = createScheduler();

		await openFlush(scheduler, producer); //resolves; nothing to re-run
		expect(producer.currentTask).toBeNull();
		expect(scheduler.flushPromise).toBeNull();
	});

	test("resetScheduler clears the batch state", () => {
		const scheduler = createScheduler();
		scheduler.flushPromise = Promise.resolve();
		scheduler.dirty = true;

		resetScheduler(scheduler);
		expect(scheduler.flushPromise).toBeNull();
		expect(scheduler.dirty).toBe(false);
	});
});
