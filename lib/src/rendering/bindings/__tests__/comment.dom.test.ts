import { describe, expect, test } from "vitest";
import { BINDING } from "../../../parser/constants";
import { UNSET_HASH } from "../../constants";
import { commitComment } from "../comment";
import { CommentLiveBinding } from "../types";

const createCommentBinding = (payloadText: string): CommentLiveBinding => {
	const container = document.createElement("div");
	const openMarker = document.createComment("");
	container.append(openMarker, document.createComment(payloadText));
	return {
		staticBinding: { type: BINDING.COMMENT, parts: [" count ", 0, " "] },
		openMarker,
		lastValueHash: UNSET_HASH,
	};
};

const countPayloadAccess = (liveBinding: CommentLiveBinding) => {
	const payload = liveBinding.openMarker.nextSibling as Comment;
	let prototype: object | null = payload;
	let descriptor: PropertyDescriptor | undefined;
	while (prototype !== null && descriptor === undefined) {
		descriptor = Object.getOwnPropertyDescriptor(prototype, "data");
		prototype = Object.getPrototypeOf(prototype);
	}
	const { get, set } = descriptor!;
	const access = { reads: 0, writes: 0 };
	Object.defineProperty(payload, "data", {
		get() {
			access.reads++;
			return get!.call(this);
		},
		set(text: string) {
			access.writes++;
			set!.call(this, text);
		},
	});
	return access;
};

describe("comment binding - writes", () => {
	test("a changed value writes the payload once", () => {
		const liveBinding = createCommentBinding(" count 1 ");
		commitComment(liveBinding, [1]);
		const access = countPayloadAccess(liveBinding);
		commitComment(liveBinding, [2]);
		expect(access.writes).toBe(1);
		expect(liveBinding.openMarker.nextSibling?.textContent).toBe(" count 2 ");
	});

	test("an unchanged value leaves the payload untouched", () => {
		const liveBinding = createCommentBinding("");
		commitComment(liveBinding, [1]);
		const access = countPayloadAccess(liveBinding);
		commitComment(liveBinding, [1]);
		expect(access).toEqual({ reads: 0, writes: 0 });
	});

	test("a first commit over server text that already matches writes nothing", () => {
		const liveBinding = createCommentBinding(" count 1 ");
		const access = countPayloadAccess(liveBinding);
		commitComment(liveBinding, [1]);
		expect(access.writes).toBe(0);
	});
});
