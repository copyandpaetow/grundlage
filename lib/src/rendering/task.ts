import { ValueOf } from "../parser/types";
import { ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/is-generator";
import { HTMLTemplate, isTemplate } from "./template-html";

//a Task is one driven coroutine and how far it got — nothing more. the component is two Task instances
//(an outer and an inner), and depth-2 nesting is one explicit recursion in the shell, not a field here.
export const TASK_STATE = {
	DRIVING: 0, //stepping the coroutine
	SUSPENDED: 1, //parked on a real promise; the shell resumes it on settle
	DONE: 2, //the coroutine returned
	FAILED: 3, //the coroutine threw (or hit the depth limit)
} as const;

//immutable per task — picks the one role-specific branch (install vs depth-limit, bubble vs terminal).
export const ROLE = { OUTER: 0, INNER: 1 } as const;

//the command vocabulary (reducer -> shell). numeric object-enum, same shape as the parser's
//BINDING_TYPES: a kind only ever pairs its own payload type. the shell executes exactly one per turn,
//then feeds the resulting event back into step.
export const COMMAND = {
	PAINT: 0, //payload: HTMLTemplate — paint it, then resume THIS task with the host
	PAINT_FROM: 1, //payload: RenderFunction — call with host, paint, then resume THIS task with the host
	INSTALL: 2, //payload: ComponentGenerator — outer only: spawn the inner, drive it inline, then resume the outer
	RESUME: 3, //payload: a plain yielded value, or a settled await — step THIS task with it
	AWAIT: 4, //payload: Promise — suspend THIS task; the shell resumes it on settle
	COMPLETED: 5, //payload: null — the coroutine returned
	THROW_TO_PARENT: 6, //payload: the error — inner only: deliver into the outer via .throw() (E1)
	FAIL: 7, //payload: the error — outer with no one to catch → terminal (E3)
	NOOP: 8, //payload: null — no transition for this (state, event) pair
} as const;

//the event vocabulary (shell -> reducer). a coroutine step produces yielded / returned / threw; a
//settled await produces resumed. an async-generator step (a .next() that returns a promise) is NOT an
//event — the shell's pull awaits it and only the settled result reaches the reducer.
export const EVENT = { YIELDED: 0, RETURNED: 1, THREW: 2, RESUMED: 3 } as const;

type CommandKind = ValueOf<typeof COMMAND>;
type EventKind = ValueOf<typeof EVENT>;

export interface Task {
	generator: Generator | AsyncGenerator;
	role: ValueOf<typeof ROLE>;
	state: ValueOf<typeof TASK_STATE>;
	cleanup: VoidFunction | null; //captured on a graceful return (D2)
}

export type Command =
	| { kind: typeof COMMAND.PAINT; payload: HTMLTemplate }
	| { kind: typeof COMMAND.PAINT_FROM; payload: RenderFunction }
	| { kind: typeof COMMAND.INSTALL; payload: ComponentGenerator }
	| { kind: typeof COMMAND.RESUME; payload: unknown }
	| { kind: typeof COMMAND.AWAIT; payload: Promise<unknown> }
	| { kind: typeof COMMAND.COMPLETED; payload: null }
	| { kind: typeof COMMAND.THROW_TO_PARENT; payload: unknown }
	| { kind: typeof COMMAND.FAIL; payload: unknown }
	| { kind: typeof COMMAND.NOOP; payload: null };

export type StepEvent =
	| { kind: typeof EVENT.YIELDED; payload: unknown }
	| { kind: typeof EVENT.RETURNED; payload: unknown }
	| { kind: typeof EVENT.THREW; payload: unknown }
	| { kind: typeof EVENT.RESUMED; payload: unknown };

//ONE reused backing cell per direction. written-once-read-once each turn => no per-yield allocation.
const commandCell = {
	kind: COMMAND.NOOP as CommandKind,
	payload: null as unknown,
};
const eventCell = {
	kind: EVENT.YIELDED as EventKind,
	payload: null as unknown,
};

//the ONLY cast on the command side. the generic checks the PRODUCER (emit(PAINT, somePromise) does not
//compile); the cast is the price of a single mutable cell standing in for the whole discriminated union.
//SAFETY: the shell consumes the cell before the next step() overwrites it — never retain a Command across
//a step() call. that write-once-read-once invariant is what keeps this honest.
const emit = <K extends CommandKind>(
	kind: K,
	payload: Extract<Command, { kind: K }>["payload"],
): Extract<Command, { kind: K }> => {
	commandCell.kind = kind;
	commandCell.payload = payload;
	return commandCell as unknown as Extract<Command, { kind: K }>;
};

//SAFETY mirrors emit: the shell consumes each StepEvent before the next event()/pull()/step() call
//overwrites the cell. every event payload is `unknown`, so there is no producer-side check to make here.
export const event = (kind: EventKind, payload: unknown): StepEvent => {
	eventCell.kind = kind;
	eventCell.payload = payload;
	return eventCell as unknown as StepEvent;
};

//the synchronous core: the whole control flow as one table, driven purely by task.state. liveness is the
//shell's concern, not the reducer's — a superseded task no longer occupies its slot, so its pending .then
//never re-enters drive and never reaches step. the only role-specific branches are the two the jobs force:
//a generator function yielded by the inner is the depth-limit error (A3), and a throw routes to the parent
//(inner) or to a terminal (outer) (E1 vs E3).
export const step = (task: Task, incomingEvent: StepEvent): Command => {
	switch (task.state) {
		case TASK_STATE.DRIVING:
			switch (incomingEvent.kind) {
				case EVENT.YIELDED: {
					const value = incomingEvent.payload;
					if (isTemplate(value)) return emit(COMMAND.PAINT, value);
					if (isGeneratorFunction(value)) {
						if (task.role === ROLE.INNER) {
							//A3: the one depth-limit error — bubbles to the outer like any inner throw
							task.state = TASK_STATE.FAILED;
							return emit(
								COMMAND.THROW_TO_PARENT,
								new Error("Inner generators cannot yield generator functions"),
							);
						}
						return emit(COMMAND.INSTALL, value as ComponentGenerator);
					}
					if (typeof value === "function")
						return emit(COMMAND.PAINT_FROM, value as RenderFunction);
					if (value instanceof Promise) {
						task.state = TASK_STATE.SUSPENDED;
						return emit(COMMAND.AWAIT, value);
					}
					return emit(COMMAND.RESUME, value); //a plain value flows straight back in
				}
				case EVENT.RETURNED:
					task.cleanup =
						typeof incomingEvent.payload === "function"
							? (incomingEvent.payload as VoidFunction)
							: null;
					task.state = TASK_STATE.DONE;
					return emit(COMMAND.COMPLETED, null);
				case EVENT.THREW:
					task.state = TASK_STATE.FAILED;
					return task.role === ROLE.INNER
						? emit(COMMAND.THROW_TO_PARENT, incomingEvent.payload)
						: emit(COMMAND.FAIL, incomingEvent.payload);
			}
			break;

		case TASK_STATE.SUSPENDED:
			if (incomingEvent.kind === EVENT.RESUMED) {
				task.state = TASK_STATE.DRIVING;
				return emit(COMMAND.RESUME, incomingEvent.payload);
			}
			if (incomingEvent.kind === EVENT.THREW) {
				task.state = TASK_STATE.FAILED;
				return task.role === ROLE.INNER
					? emit(COMMAND.THROW_TO_PARENT, incomingEvent.payload)
					: emit(COMMAND.FAIL, incomingEvent.payload);
			}
			break;
	}
	return emit(COMMAND.NOOP, null);
};
