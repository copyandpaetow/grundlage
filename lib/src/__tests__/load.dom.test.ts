import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushHostPayload, load, warnOnUnclaimedSsrPayloads } from "../load";

//happy-dom env — `window` is defined here, so load takes the client path
//these tests cover the DOM-as-queue behavior plus the round-trip via flushHostPayload

const createHostWithShadow = (): HTMLElement => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" });
	document.body.appendChild(host);
	return host;
};

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("client replay reads scripts from the host's shadow root", () => {
	test("returns the parsed value and removes the script so the next read sees the next entry", async () => {
		const host = createHostWithShadow();
		const fragment = document.createDocumentFragment();
		const first = document.createElement("script");
		first.setAttribute("type", "application/json");
		first.setAttribute("data-ssr", "");
		first.textContent = JSON.stringify({ name: "Ada" });
		const second = document.createElement("script");
		second.setAttribute("type", "application/json");
		second.setAttribute("data-ssr", "");
		second.textContent = JSON.stringify({ name: "Lin" });
		fragment.appendChild(first);
		fragment.appendChild(second);
		host.shadowRoot!.prepend(fragment);

		const fetcher = vi.fn(() => Promise.resolve({ name: "fallback" }));
		const a = await load(host, fetcher);
		const b = await load(host, fetcher);

		expect(a).toEqual({ name: "Ada" });
		expect(b).toEqual({ name: "Lin" });
		expect(fetcher).not.toHaveBeenCalled();
		expect(host.shadowRoot!.querySelector("script[data-ssr]")).toBeNull();
	});

	test("falls back to the fetcher when no replay script is left", async () => {
		const host = createHostWithShadow();
		const fetcher = vi.fn(() => Promise.resolve("fetched"));
		const value = await load(host, fetcher);
		expect(value).toBe("fetched");
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("keyed read ignores unkeyed scripts and finds the matching key", async () => {
		const host = createHostWithShadow();
		const unkeyed = document.createElement("script");
		unkeyed.setAttribute("type", "application/json");
		unkeyed.setAttribute("data-ssr", "");
		unkeyed.textContent = JSON.stringify("not-this-one");
		const keyed = document.createElement("script");
		keyed.setAttribute("type", "application/json");
		keyed.setAttribute("data-ssr", "");
		keyed.setAttribute("data-key", "posts");
		keyed.textContent = JSON.stringify(["p1", "p2"]);
		host.shadowRoot!.append(unkeyed, keyed);

		const value = await load(host, () => Promise.resolve([]), "posts");
		expect(value).toEqual(["p1", "p2"]);
		//keyed script removed; the unkeyed one is left for a future unkeyed read
		expect(
			host.shadowRoot!.querySelector('script[data-key="posts"]'),
		).toBeNull();
		expect(
			host.shadowRoot!.querySelector("script[data-ssr]:not([data-key])"),
		).not.toBeNull();
	});

	test("unkeyed reads do not consume keyed scripts", async () => {
		const host = createHostWithShadow();
		const keyed = document.createElement("script");
		keyed.setAttribute("type", "application/json");
		keyed.setAttribute("data-ssr", "");
		keyed.setAttribute("data-key", "user");
		keyed.textContent = JSON.stringify("keyed-value");
		host.shadowRoot!.append(keyed);

		const fetcher = vi.fn(() => Promise.resolve("fresh"));
		const value = await load(host, fetcher);
		expect(value).toBe("fresh");
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(
			host.shadowRoot!.querySelector('script[data-key="user"]'),
		).not.toBeNull();
	});

	test("skipSsr bypasses replay even when a matching script is present", async () => {
		const host = createHostWithShadow();
		const script = document.createElement("script");
		script.setAttribute("type", "application/json");
		script.setAttribute("data-ssr", "");
		script.textContent = JSON.stringify("should-not-be-read");
		host.shadowRoot!.append(script);

		const fetcher = vi.fn(() => Promise.resolve("forced"));
		const value = await load(host, fetcher, { skipSsr: true });
		expect(value).toBe("forced");
		expect(host.shadowRoot!.querySelector("script[data-ssr]")).not.toBeNull();
	});
});

describe("warnOnUnclaimedSsrPayloads flags drift between server and client load() calls", () => {
	test("warns with a count when unclaimed data-ssr scripts remain after hydration", async () => {
		const host = createHostWithShadow();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = document.createElement("script");
		first.setAttribute("type", "application/json");
		first.setAttribute("data-ssr", "");
		first.textContent = JSON.stringify("posts");
		const second = document.createElement("script");
		second.setAttribute("type", "application/json");
		second.setAttribute("data-ssr", "");
		second.setAttribute("data-key", "user");
		second.textContent = JSON.stringify("user");
		host.shadowRoot!.append(first, second);

		//simulates a conditional load() call that never ran on the client this time
		await load(host, () => Promise.resolve("fallback"));

		warnOnUnclaimedSsrPayloads(host.shadowRoot!);

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toContain("1 SSR load()");
		warnSpy.mockRestore();
	});

	test("does not warn once every replayed script has been claimed", async () => {
		const host = createHostWithShadow();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const script = document.createElement("script");
		script.setAttribute("type", "application/json");
		script.setAttribute("data-ssr", "");
		script.textContent = JSON.stringify("posts");
		host.shadowRoot!.append(script);

		await load(host, () => Promise.resolve("fallback"));

		warnOnUnclaimedSsrPayloads(host.shadowRoot!);

		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

//load branches on `typeof window === "undefined"` at call time
//swapping it out drives the server-side collect path against a real shadow root, which is what
//makes flushHostPayload's writes assertable
const withoutWindow = async <ReturnValue>(
	body: () => Promise<ReturnValue>,
): Promise<ReturnValue> => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
	delete (globalThis as { window?: unknown }).window;
	try {
		return await body();
	} finally {
		if (descriptor !== undefined)
			Object.defineProperty(globalThis, "window", descriptor);
	}
};

describe("flushHostPayload writes server-collected values into the shadow root", () => {
	test("emits one script per collected value, in call order, appended after existing shadow root content", async () => {
		const host = createHostWithShadow();
		host.shadowRoot!.append(document.createElement("article"));

		await withoutWindow(async () => {
			await load(host, () => Promise.resolve("alpha"));
			await load(host, () => Promise.resolve("beta-value"), "beta");
		});
		flushHostPayload(host);

		const children = host.shadowRoot!.children;
		expect(children.length).toBe(3);
		//pre-existing user content stays at the front; scripts are appended after it
		expect(children[0].tagName).toBe("ARTICLE");
		expect(children[1].tagName).toBe("SCRIPT");
		expect(children[1].getAttribute("data-ssr")).toBe("");
		expect(children[1].getAttribute("data-key")).toBeNull();
		expect(children[1].textContent).toBe(JSON.stringify("alpha"));
		expect(children[2].tagName).toBe("SCRIPT");
		expect(children[2].getAttribute("data-key")).toBe("beta");
		expect(children[2].textContent).toBe(JSON.stringify("beta-value"));
	});

	test("flush clears the per-host scratch — a second flush is a no-op", async () => {
		const host = createHostWithShadow();
		await withoutWindow(async () => {
			await load(host, () => Promise.resolve("once"));
		});
		flushHostPayload(host);
		expect(host.shadowRoot!.children.length).toBe(1);
		flushHostPayload(host);
		expect(host.shadowRoot!.children.length).toBe(1);
	});

	test("a skipSsr load runs the fetcher but emits no script — nothing to replay on the client", async () => {
		const host = createHostWithShadow();
		const fetcher = vi.fn(() => Promise.resolve("server-only"));
		const value = await withoutWindow(() =>
			load(host, fetcher, { skipSsr: true }),
		);
		flushHostPayload(host);

		expect(value).toBe("server-only");
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(host.shadowRoot!.querySelector("script[data-ssr]")).toBeNull();
	});

	test("escapes `<` so a value containing `</script>` cannot break out of the inline script context", async () => {
		const host = createHostWithShadow();
		const payload = { body: "</script><script>alert(1)</script>" };
		await withoutWindow(async () => {
			await load(host, () => Promise.resolve(payload));
		});
		flushHostPayload(host);

		const script = host.shadowRoot!.querySelector("script[data-ssr]")!;
		expect(script.textContent).not.toContain("</script>");
		expect(script.textContent).toContain("\\u003c/script>");
		//round-trips back to the original after the browser parses the inline JSON
		expect(JSON.parse(script.textContent!)).toEqual(payload);
	});

	test("a host that never called load survives flushHostPayload as a no-op", () => {
		const host = createHostWithShadow();
		host.shadowRoot!.append(document.createElement("article"));
		flushHostPayload(host);
		expect(host.shadowRoot!.children.length).toBe(1);
		expect(host.shadowRoot!.children[0].tagName).toBe("ARTICLE");
	});

	test("a fetcher that resolves undefined does not crash the flush", async () => {
		//JSON.stringify(undefined) returns the value undefined, not a string, so the
		//following .replace() would throw and serialize the whole component as error text
		const host = createHostWithShadow();
		await withoutWindow(async () => {
			await load(host, () => Promise.resolve(undefined));
		});
		expect(() => flushHostPayload(host)).not.toThrow();
	});
});
