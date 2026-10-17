import { ComponentRoot } from "../rendering/component-root";

//the fallback order where no paint caused an update: a server-rendered child hydrates when its
//module loads
export interface OrderedRunner {
	root: ComponentRoot;
	//the nearest runner above this one in the shadow trees, learned lazily, kept until the host moves
	ancestorRunner: OrderedRunner | null;
	lastAncestorSearchAtHostRegistrationCount: number;
}

interface RunnerRegistry {
	runnersByHost: WeakMap<Element, OrderedRunner>;
	hostRegistrationCount: number;
}

const createRunnerRegistry = (): RunnerRegistry => ({
	runnersByHost: new WeakMap(),
	hostRegistrationCount: 0,
});

//one for the page: the ancestor search climbs from any host into any other component's shadow tree
const registry = createRunnerRegistry();

//the registration count starts at 0 and only grows
export const NEVER_SEARCHED = -1;

export const registerRunnerForHost = (runner: OrderedRunner): void => {
	registry.runnersByHost.set(runner.root.host, runner);
	registry.hostRegistrationCount++;
};

//the WeakMap entry dies with the host, the edge does not. A move can put a different component
//above this one and a stale edge would close the ancestor chain into a ring, so any insert drops it
export const forgetAncestorRunner = (runner: OrderedRunner): void => {
	runner.ancestorRunner = null;
	runner.lastAncestorSearchAtHostRegistrationCount = NEVER_SEARCHED;
};

const findNearestAncestorRunner = (host: Element): OrderedRunner | null => {
	for (
		let root = host.getRootNode();
		root instanceof ShadowRoot;
		root = root.host.getRootNode()
	) {
		const ancestorRunner = registry.runnersByHost.get(root.host);
		if (ancestorRunner !== undefined) return ancestorRunner;
	}
	return null;
};

//the whole chain and not just the nearest runner above it: a component nothing dirtied sits
//between two that were
export const hasQueuedAncestorRunner = (
	runner: OrderedRunner,
	queuedRunners: ReadonlySet<OrderedRunner>,
): boolean => {
	const hostRegistrationCount = registry.hostRegistrationCount;
	//ends at the outermost component: forgetAncestorRunner drops a moved host's edge, so no chain
	//closes into a ring
	for (
		let current: OrderedRunner | null = runner;
		current !== null;
		current = current.ancestorRunner
	) {
		//registerRunnerForHost is the only thing that can change the answer, so its count is an exact
		//memo key rather than a heuristic, and a settled app walks the tree zero times
		const mustSearchAgain =
			current.ancestorRunner === null &&
			current.lastAncestorSearchAtHostRegistrationCount !==
				hostRegistrationCount;
		if (mustSearchAgain) {
			current.lastAncestorSearchAtHostRegistrationCount = hostRegistrationCount;
			current.ancestorRunner = findNearestAncestorRunner(current.root.host);
		}
		const ancestor = current.ancestorRunner;
		const isAncestorQueued = ancestor !== null && queuedRunners.has(ancestor);
		if (isAncestorQueued) return true;
	}
	return false;
};
