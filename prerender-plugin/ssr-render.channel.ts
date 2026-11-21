//the two threads ask each other: the main thread asks the worker to render a page, and the worker
//asks the main thread for each module that page imports. A reply finds its request by id
type RealmMessage =
	| { kind: "request"; id: number; name: string; data: unknown }
	| { kind: "notice"; name: string; data: unknown }
	| { kind: "reply"; id: number; result: unknown }
	| { kind: "failure"; id: number; error: unknown };

//the worker on the main thread's side, `parentPort` on the worker's
export interface MessageEndpoint {
	postMessage(message: RealmMessage): void;
	on(event: "message", listener: (message: RealmMessage) => void): unknown;
}

//a request is answered with what its handler returns; a notice gets no answer
export type MessageHandlers = Record<string, (data: never) => unknown>;

export interface RealmChannel {
	request: (name: string, data: unknown) => Promise<unknown>;
	notify: (name: string, data: unknown) => void;
	failPendingRequests: (error: Error) => void;
}

export const openRealmChannel = (
	endpoint: MessageEndpoint,
	handlers: MessageHandlers,
): RealmChannel => {
	const pendingRequests = new Map<number, PromiseWithResolvers<unknown>>();
	let nextRequestId = 0;

	const answer = async (id: number, name: string, data: unknown): Promise<void> => {
		try {
			const result = await handlers[name](data as never);
			endpoint.postMessage({ kind: "reply", id, result });
		} catch (error) {
			endpoint.postMessage({ kind: "failure", id, error });
		}
	};

	endpoint.on("message", (message) => {
		switch (message.kind) {
			case "request":
				void answer(message.id, message.name, message.data);
				return;
			case "notice":
				handlers[message.name](message.data as never);
				return;
			case "reply":
				pendingRequests.get(message.id)?.resolve(message.result);
				pendingRequests.delete(message.id);
				return;
			case "failure":
				pendingRequests.get(message.id)?.reject(message.error);
				pendingRequests.delete(message.id);
				return;
			default:
				return message satisfies never;
		}
	});

	return {
		request: (name, data) => {
			const id = nextRequestId;
			nextRequestId += 1;
			const reply = Promise.withResolvers<unknown>();
			pendingRequests.set(id, reply);
			endpoint.postMessage({ kind: "request", id, name, data });
			return reply.promise;
		},
		notify: (name, data) => {
			endpoint.postMessage({ kind: "notice", name, data });
		},
		failPendingRequests: (error) => {
			for (const reply of pendingRequests.values()) reply.reject(error);
			pendingRequests.clear();
		},
	};
};
