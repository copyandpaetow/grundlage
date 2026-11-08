import { afterEach, expect, inject, test, vi } from "vitest";
import { component, html, prop, type YieldableValue } from "../../index";

//seeded random component programs against random event schedules. A failure prints the seed and the
//program, so it replays exactly
//npm run fuzz raises the count and moves the first seed; npm test keeps the defaults
const FUZZ_SCALE = inject("fuzzScale");
const SEED_COUNT = 400 * FUZZ_SCALE;
const FIRST_SEED = inject("fuzzFirstSeed") ?? 1;
const SELF_ENDING_WEIGHT = Number(process.env.DRIVER_FUZZ_SELF_ENDING_WEIGHT ?? 0.5);

type Ending = "cleanup" | "value" | "nothing";

type UpdateStep =
	| { kind: "paint"; text: string }
	| { kind: "wait"; promiseIndex: number }
	| { kind: "throw" }
	| { kind: "writeRefusedProp" }
	| { kind: "update" }
	| { kind: "yieldNestedUpdateGenerator" };

type BodyStep =
	| { kind: "paint"; text: string }
	| { kind: "wait"; promiseIndex: number }
	| { kind: "throw" }
	| { kind: "writeRefusedProp" }
	| { kind: "update" }
	| {
			kind: "yieldUpdateGenerator";
			steps: Array<UpdateStep>;
			ending: Ending;
			isCaught: boolean;
	  };

type ScheduleEvent =
	| { kind: "resolve"; promiseIndex: number }
	| { kind: "reject"; promiseIndex: number }
	| { kind: "update" }
	| { kind: "toggleConnection" }
	| { kind: "setLabel"; value: "ok" | "refused" };

interface Program {
	body: Array<BodyStep>;
	bodyHasCleanup: boolean;
	schedule: Array<ScheduleEvent>;
	promiseCount: number;
}

//mulberry32
const createRandom = (seed: number) => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
};

const createProgram = (random: () => number): Program => {
	const integerBelow = (limit: number) => Math.floor(random() * limit);
	const promiseCount = 1 + integerBelow(4);
	const pick = <Value>(weighted: Array<[number, () => Value]>): Value => {
		const total = weighted.reduce((sum, [weight]) => sum + weight, 0);
		let roll = random() * total;
		for (const [weight, create] of weighted) {
			roll -= weight;
			if (roll < 0) return create();
		}
		return weighted[weighted.length - 1][1]();
	};
	let paintCount = 0;
	const createUpdateStep = (): UpdateStep =>
		pick<UpdateStep>([
			[5, () => ({ kind: "paint", text: `update paint ${paintCount++}` })],
			[4, () => ({ kind: "wait", promiseIndex: integerBelow(promiseCount) })],
			[1, () => ({ kind: "throw" })],
			[SELF_ENDING_WEIGHT, () => ({ kind: "writeRefusedProp" })],
			[1, () => ({ kind: "update" })],
			[0.5, () => ({ kind: "yieldNestedUpdateGenerator" })],
		]);
	const createEnding = (): Ending =>
		pick<Ending>([
			[1, () => "cleanup"],
			[1, () => "value"],
			[1, () => "nothing"],
		]);
	const createBodyStep = (): BodyStep =>
		pick<BodyStep>([
			[4, () => ({ kind: "paint", text: `body paint ${paintCount++}` })],
			[3, () => ({ kind: "wait", promiseIndex: integerBelow(promiseCount) })],
			[0.5, () => ({ kind: "throw" })],
			[SELF_ENDING_WEIGHT, () => ({ kind: "writeRefusedProp" })],
			[0.5, () => ({ kind: "update" })],
			[
				5,
				() => ({
					kind: "yieldUpdateGenerator",
					steps: Array.from({ length: 1 + integerBelow(4) }, createUpdateStep),
					ending: createEnding(),
					isCaught: random() < 0.5,
				}),
			],
		]);
	const createScheduleEvent = (): ScheduleEvent =>
		pick<ScheduleEvent>([
			[4, () => ({ kind: "resolve", promiseIndex: integerBelow(promiseCount) })],
			[1, () => ({ kind: "reject", promiseIndex: integerBelow(promiseCount) })],
			[3, () => ({ kind: "update" })],
			[1.5, () => ({ kind: "toggleConnection" })],
			[1, () => ({ kind: "setLabel", value: "ok" })],
			[0.3, () => ({ kind: "setLabel", value: "refused" })],
		]);
	return {
		body: Array.from({ length: 1 + integerBelow(5) }, createBodyStep),
		bodyHasCleanup: random() < 0.5,
		schedule: Array.from({ length: 2 + integerBelow(10) }, createScheduleEvent),
		promiseCount,
	};
};

const refusingResolver = (value: unknown) => {
	if (value === "refused") throw new Error("refused");
	return value;
};

const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

interface TestHost extends HTMLElement {
	label: unknown;
	update(): Promise<void>;
}

let tagCounter = 0;

//every invariant reads as one sentence, so a reviewer checks five sentences, not the interleavings
const runProgram = async (program: Program): Promise<Array<string>> => {
	const violations: Array<string> = [];
	const deferreds = Array.from({ length: program.promiseCount }, () =>
		Promise.withResolvers<unknown>(),
	);
	for (let index = 0; index < deferreds.length; index++) deferreds[index].promise.catch(() => {});
	const finallyCountByRun: Array<number> = [];
	const callCountByCleanup: Array<number> = [];
	const updates: Array<{ isSettled: boolean }> = [];
	let selfUpdateBudget = 3;
	let lastVisibleText = "";
	let hasEndedWithError = false;
	let isConnected = false;

	const trackUpdate = (promise: Promise<void>) => {
		const entry = { isSettled: false };
		void promise.then(() => (entry.isSettled = true));
		updates.push(entry);
	};
	const recordPaint = (text: string) => {
		if (hasEndedWithError && isConnected) {
			violations.push(`painted "${text}" after the component ended with an error`);
		}
		lastVisibleText = text;
	};
	const createCleanup = () => {
		const cleanupIndex = callCountByCleanup.push(0) - 1;
		return () => {
			callCountByCleanup[cleanupIndex]++;
		};
	};
	const startRun = () => finallyCountByRun.push(0) - 1;

	const createUpdateGenerator = (steps: Array<UpdateStep>, ending: Ending) =>
		function* view({ host }: { host: TestHost }): Generator<YieldableValue, unknown, unknown> {
			const runIndex = startRun();
			try {
				for (const step of steps) {
					switch (step.kind) {
						case "paint":
							yield html`<p>${step.text}</p>`;
							recordPaint(step.text);
							break;
						case "wait":
							yield deferreds[step.promiseIndex].promise;
							break;
						case "throw":
							throw new Error("update generator threw");
						case "writeRefusedProp":
							host.label = "refused";
							break;
						case "update":
							if (selfUpdateBudget-- > 0) trackUpdate(host.update());
							break;
						case "yieldNestedUpdateGenerator":
							yield function* nested() {};
							break;
						default:
							return step satisfies never;
					}
				}
				if (ending === "cleanup") return createCleanup();
				if (ending === "value") return "returned value";
				return undefined;
			} finally {
				finallyCountByRun[runIndex]++;
			}
		};

	const tag = `driver-invariants-${tagCounter++}`;
	customElements.define(
		tag,
		component(
			function* ({ host }) {
				const runIndex = startRun();
				try {
					for (const step of program.body) {
						switch (step.kind) {
							case "paint":
								yield html`<p>${step.text}</p>`;
								recordPaint(step.text);
								break;
							case "wait":
								yield deferreds[step.promiseIndex].promise;
								break;
							case "throw":
								throw new Error("body threw");
							case "writeRefusedProp":
								host.label = "refused";
								break;
							case "update":
								trackUpdate(host.update());
								break;
							case "yieldUpdateGenerator": {
								const updateGenerator = createUpdateGenerator(step.steps, step.ending);
								if (!step.isCaught) {
									yield updateGenerator;
									break;
								}
								try {
									yield updateGenerator;
								} catch {
									yield html`<p>caught</p>`;
									recordPaint("caught");
								}
								break;
							}
							default:
								return step satisfies never;
						}
					}
					return program.bodyHasCleanup ? createCleanup() : undefined;
				} finally {
					finallyCountByRun[runIndex]++;
				}
			},
			{ props: { label: prop.optional(prop.attribute(refusingResolver)) } },
		),
	);
	const element = document.createElement(tag) as TestHost;
	element.addEventListener("grundlage-error", (event) => {
		hasEndedWithError = true;
		lastVisibleText = String((event as Event & { error: unknown }).error);
	});

	const act = (description: string, action: () => void) => {
		try {
			action();
		} catch (error) {
			violations.push(`${description} threw out of the library: ${String(error)}`);
		}
	};
	const checkAtRest = (after: string) => {
		const shownText = element.shadowRoot?.textContent ?? "";
		if (isConnected && shownText !== lastVisibleText) {
			violations.push(
				`after ${after}: shows "${shownText}", but the last paint or error was "${lastVisibleText}"`,
			);
		}
	};

	act("the first insertion", () => {
		isConnected = true;
		document.body.append(element);
	});
	await sleep();
	checkAtRest("the first insertion");

	for (const event of program.schedule) {
		const description = JSON.stringify(event);
		switch (event.kind) {
			case "resolve":
				act(description, () => deferreds[event.promiseIndex].resolve("resolved"));
				break;
			case "reject":
				act(description, () => deferreds[event.promiseIndex].reject(new Error("rejected")));
				break;
			case "update":
				act(description, () => trackUpdate(element.update()));
				break;
			case "toggleConnection":
				act(description, () => {
					if (isConnected) {
						isConnected = false;
						hasEndedWithError = false;
						element.remove();
					} else {
						isConnected = true;
						document.body.append(element);
					}
				});
				break;
			case "setLabel":
				act(description, () => element.setAttribute("label", event.value));
				break;
			default:
				return event satisfies never;
		}
		await sleep();
		checkAtRest(description);
		if (!isConnected) {
			const unsettledCount = updates.filter((update) => !update.isSettled).length;
			if (unsettledCount > 0) {
				violations.push(
					`after ${description}: ${unsettledCount} update() still pending on a removed host`,
				);
			}
		}
	}

	for (let index = 0; index < deferreds.length; index++) {
		deferreds[index].resolve("resolved at the end");
	}
	await sleep();
	await sleep();
	checkAtRest("settling every promise");
	const unsettledAtEndCount = updates.filter((update) => !update.isSettled).length;
	if (unsettledAtEndCount > 0) {
		violations.push(`${unsettledAtEndCount} update() still pending after every promise settled`);
	}

	act("the final removal", () => {
		isConnected = false;
		element.remove();
	});
	await sleep();
	await sleep();
	for (let index = 0; index < finallyCountByRun.length; index++) {
		if (finallyCountByRun[index] === 1) continue;
		violations.push(`run ${index} ran its finally ${finallyCountByRun[index]} times, not once`);
	}
	for (let index = 0; index < callCountByCleanup.length; index++) {
		if (callCountByCleanup[index] === 1) continue;
		violations.push(`cleanup ${index} ran ${callCountByCleanup[index]} times, not once`);
	}
	return violations;
};

afterEach(() => {
	vi.restoreAllMocks();
});

test(
	`the driver keeps its invariants over ${SEED_COUNT} random programs`,
	async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const escapedErrors: Array<unknown> = [];
		const recordEscapedError = (error: unknown) => escapedErrors.push(error);
		process.on("unhandledRejection", recordEscapedError);
		const failures: Array<string> = [];
		try {
			for (let seed = FIRST_SEED; seed < FIRST_SEED + SEED_COUNT; seed++) {
				const program = createProgram(createRandom(seed));
				const escapedBefore = escapedErrors.length;
				const violations = await runProgram(program);
				for (let index = escapedBefore; index < escapedErrors.length; index++) {
					violations.push(`escaped asynchronously: ${String(escapedErrors[index])}`);
				}
				if (violations.length > 0) {
					failures.push(
						`seed ${seed}:\n  ${violations.join("\n  ")}\n  program: ${JSON.stringify(program)}`,
					);
				}
			}
		} finally {
			process.off("unhandledRejection", recordEscapedError);
		}
		const violationKinds = new Map<string, number>();
		for (const failure of failures) {
			for (const line of failure.split("\n").slice(1, -1)) {
				const kind = line
					.trim()
					.replace(/\d+/g, "#")
					.replace(/"[^"]*"/g, '"…"');
				violationKinds.set(kind, (violationKinds.get(kind) ?? 0) + 1);
			}
		}
		const summary = [...violationKinds].map(([kind, count]) => `${count}× ${kind}`);
		expect(
			`${failures.length} of ${SEED_COUNT} seeds failed\n${summary.join("\n")}\n\n${failures
				.filter((failure) => failure.includes(process.env.DRIVER_FUZZ_SHOW ?? ""))
				.slice(0, 3)
				.join("\n\n")}`,
		).toBe(`0 of ${SEED_COUNT} seeds failed\n\n\n`);
	},
	120_000 * FUZZ_SCALE,
);
