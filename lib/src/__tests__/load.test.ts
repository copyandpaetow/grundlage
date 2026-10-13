import { describe, expect, test, vi } from "vitest";
import { flushHostPayload, load } from "../load";

//node env — `window` is undefined here, so load takes the server path
//the server-side collection and flushHostPayload contract; the client-side DOM behaviour lives in
//load.dom.test.ts

//a minimal host stand-in: WeakMap keying needs only object identity, and flushHostPayload bails
//when shadowRoot or ownerDocument is missing
const createServerHost = (): Element => ({}) as unknown as Element;

describe("load on the server collects values per host", () => {
	test("returns the fetcher's value to the generator immediately", async () => {
		const host = createServerHost();
		const fetcher = vi.fn(() => Promise.resolve({ name: "Ada" }));
		const value = await load(host, fetcher);
		expect(value).toEqual({ name: "Ada" });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("flushHostPayload is a no-op when nothing was loaded", () => {
		const host = createServerHost();
		expect(() => flushHostPayload(host)).not.toThrow();
	});

	test("flushHostPayload bails when the host has no shadow root", async () => {
		const host = createServerHost();
		await load(host, () => Promise.resolve("anything"));
		//missing shadowRoot/ownerDocument — bails without touching the host
		expect(() => flushHostPayload(host)).not.toThrow();
	});

	test("string options shorthand is equivalent to { key }", async () => {
		const host = createServerHost();
		const a = await load(host, () => Promise.resolve(1), "shorthand");
		const b = await load(host, () => Promise.resolve(2), { key: "object" });
		expect(a).toBe(1);
		expect(b).toBe(2);
	});
});
