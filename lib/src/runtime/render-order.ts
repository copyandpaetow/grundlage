import { BaseComponent } from "../types";

//two edges: the causal edge is exact but exists only when a paint caused this render, and a
//server-rendered child hydrates when its module loads, which no paint causes
export interface OrderedRun {
	host: BaseComponent;
	//rewritten on every enqueue, cleared on dequeue: the run whose paint asked for this render. Any
	//run can be the causer, since a paint reaches a component beside it through a plain setter
	blockedByRun: OrderedRun | null;
	//the nearest run above this one in the shadow trees, learned lazily and kept until the host moves
	ancestorRun: OrderedRun | null;
	lastAncestorSearchAtHostRegistrationCount: number;
}

interface RunRegistry {
	runsByHost: WeakMap<Element, OrderedRun>;
	hostRegistrationCount: number;
}

const createRunRegistry = (): RunRegistry => ({
	runsByHost: new WeakMap(),
	hostRegistrationCount: 0,
});

const registry = createRunRegistry();

export const createRunOrdering = (): Omit<OrderedRun, "host"> => ({
	blockedByRun: null,
	ancestorRun: null,
	lastAncestorSearchAtHostRegistrationCount: -1,
});

export const registerRunForItsHost = (run: OrderedRun): void => {
	registry.runsByHost.set(run.host, run);
	registry.hostRegistrationCount++;
};

//the WeakMap entry dies with the host, the two edges do not. A move can put a different component
//above this one and a stale edge would close the ancestor chain into a ring, so any insert drops it
export const forgetWhereThisRunSits = (run: OrderedRun): void => {
	run.blockedByRun = null;
	run.ancestorRun = null;
	run.lastAncestorSearchAtHostRegistrationCount = -1;
};

const findNearestAncestorRun = (host: Element): OrderedRun | null => {
	let node: Node = host;
	while (true) {
		const root = node.getRootNode();
		if (!(root instanceof ShadowRoot)) return null;
		const ancestorRun = registry.runsByHost.get(root.host);
		if (ancestorRun !== undefined) return ancestorRun;
		node = root.host;
	}
};

//registerRunForItsHost is the only thing that can change the answer, so its count is an exact memo
//key rather than a heuristic, and a settled app walks the tree zero times
const ancestorRunOf = (run: OrderedRun): OrderedRun | null => {
	if (run.ancestorRun !== null) return run.ancestorRun;
	const count = registry.hostRegistrationCount;
	if (run.lastAncestorSearchAtHostRegistrationCount === count) return null;
	run.lastAncestorSearchAtHostRegistrationCount = count;
	run.ancestorRun = findNearestAncestorRun(run.host);
	return run.ancestorRun;
};

export const recordWhoCausedThisRender = (
	run: OrderedRun,
	painter: OrderedRun | null,
): void => {
	if (painter === run) {
		run.blockedByRun = null;
		return;
	}
	//an update from outside a paint says nothing about order, so it may not erase what a paint said.
	//The edge only lives from the enqueue to the dequeue, so there is no stale answer to keep
	if (painter !== null) run.blockedByRun = painter;
};

//the one clear, and what lets recordWhoCausedThisRender refuse to erase what a paint said: an edge
//that outlived its render would block a later one, and holding the causer pins that component's host
export const forgetWhoCausedThisRender = (run: OrderedRun): void => {
	run.blockedByRun = null;
};

export const isBlockedByAQueuedRun = (
	run: OrderedRun,
	queuedRuns: ReadonlySet<OrderedRun>,
): boolean => {
	//the causal edge is exact, so where a paint asked for this render there is nothing left to infer
	if (run.blockedByRun !== null) return queuedRuns.has(run.blockedByRun);
	//no paint asked, so the shadow trees are all there is. The whole chain and not just the nearest
	//run above it: a component nothing dirtied sits between two that were
	for (
		let ancestor = ancestorRunOf(run);
		ancestor !== null;
		ancestor = ancestorRunOf(ancestor)
	)
		if (queuedRuns.has(ancestor)) return true;
	return false;
};
