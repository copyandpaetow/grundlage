import { ComponentRoot } from "../rendering/component-root";

//the fallback order where no paint caused a render: a server-rendered child hydrates when its
//module loads
export interface OrderedRun {
	root: ComponentRoot;
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

//one for the page: the ancestor search climbs from any host into any other component's shadow tree
const registry = createRunRegistry();

//the registration count starts at 0 and only grows
export const NEVER_SEARCHED = -1;

export const registerRunForItsHost = (run: OrderedRun): void => {
	registry.runsByHost.set(run.root.host, run);
	registry.hostRegistrationCount++;
};

//the WeakMap entry dies with the host, the edge does not. A move can put a different component
//above this one and a stale edge would close the ancestor chain into a ring, so any insert drops it
export const forgetWhereThisRunSits = (run: OrderedRun): void => {
	run.ancestorRun = null;
	run.lastAncestorSearchAtHostRegistrationCount = NEVER_SEARCHED;
};

const findNearestAncestorRun = (host: Element): OrderedRun | null => {
	for (
		let root = host.getRootNode();
		root instanceof ShadowRoot;
		root = root.host.getRootNode()
	) {
		const ancestorRun = registry.runsByHost.get(root.host);
		if (ancestorRun !== undefined) return ancestorRun;
	}
	return null;
};

//the whole chain and not just the nearest run above it: a component nothing dirtied sits between
//two that were
export const hasQueuedAncestorRun = (
	run: OrderedRun,
	queuedRuns: ReadonlySet<OrderedRun>,
): boolean => {
	const hostRegistrationCount = registry.hostRegistrationCount;
	//ends at the outermost component: forgetWhereThisRunSits drops a moved host's edge, so no chain
	//closes into a ring
	for (
		let current: OrderedRun | null = run;
		current !== null;
		current = current.ancestorRun
	) {
		//registerRunForItsHost is the only thing that can change the answer, so its count is an exact
		//memo key rather than a heuristic, and a settled app walks the tree zero times
		const mustSearchAgain =
			current.ancestorRun === null &&
			current.lastAncestorSearchAtHostRegistrationCount !==
				hostRegistrationCount;
		if (mustSearchAgain) {
			current.lastAncestorSearchAtHostRegistrationCount = hostRegistrationCount;
			current.ancestorRun = findNearestAncestorRun(current.root.host);
		}
		const ancestor = current.ancestorRun;
		const isAncestorQueued = ancestor !== null && queuedRuns.has(ancestor);
		if (isAncestorQueued) return true;
	}
	return false;
};
