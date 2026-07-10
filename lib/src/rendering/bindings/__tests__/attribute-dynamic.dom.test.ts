import { describe, expect, test, vi } from "vitest";
import {
	applyDynamicAttribute,
	normalizeToAttributeMap,
} from "../attribute-dynamic";

describe("applyDynamicAttribute - event listeners", () => {
	test("attaches an event listener for an on* key whose value is a function", () => {
		const element = document.createElement("button");
		const events: Array<string> = [];
		const handler = () => events.push("clicked");

		applyDynamicAttribute(element, "onclick", handler);

		// addEventListener path: the attribute itself must NOT be set.
		expect(element.hasAttribute("onclick")).toBe(false);

		element.click();
		expect(events).toEqual(["clicked"]);
	});

	test("removes the previous listener and attaches the new one when both are functions", () => {
		const element = document.createElement("button");
		const events: Array<string> = [];
		const firstHandler = () => events.push("first");
		const secondHandler = () => events.push("second");

		applyDynamicAttribute(element, "onclick", firstHandler);
		applyDynamicAttribute(element, "onclick", secondHandler, firstHandler);

		element.click();
		expect(events).toEqual(["second"]);
	});

	test("detaches the listener when value is null and oldValue is a function", () => {
		const element = document.createElement("button");
		const events: Array<string> = [];
		const handler = () => events.push("clicked");

		applyDynamicAttribute(element, "onclick", handler);
		applyDynamicAttribute(element, "onclick", null, handler);

		element.click();
		expect(events).toEqual([]);
	});

	test("uppercase event keys still resolve via the lowercased lookup", () => {
		// The fast path lowercases before the `in element` check, so authored
		// keys like onClick or ONCLICK still bind to the click event.
		const element = document.createElement("button");
		const events: Array<string> = [];
		const handler = () => events.push("clicked");

		applyDynamicAttribute(element, "onClick", handler);
		element.click();
		expect(events).toEqual(["clicked"]);
	});

	test("on-prefixed key that is not a real event property falls through to setAttribute", () => {
		// "ondata" isn't on HTMLElement.prototype, so the `lowerKey in element`
		// guard short-circuits the listener path. Such keys (with stringable
		// values) should land as ordinary attributes.
		const element = document.createElement("div");
		expect("ondata" in element).toBe(false);

		applyDynamicAttribute(element, "ondata", "payload");
		expect(element.getAttribute("ondata")).toBe("payload");
	});

	test("on-prefixed key with non-stringable value and no matching event becomes a JS property", () => {
		// The on* fast path only fires when value or oldValue is a function. A
		// non-function, non-stringable value with an unknown on* key should land
		// on the JS property side, not as an attribute.
		const element = document.createElement("div");
		const payload = { nested: 1 };

		applyDynamicAttribute(element, "ondata", payload);
		expect((element as unknown as { ondata: unknown }).ondata).toBe(payload);
		expect(element.hasAttribute("ondata")).toBe(false);
	});
});

describe("applyDynamicAttribute - exotic event names and CustomEvent payloads", () => {
	// The `on*` fast path keys on `lowerKey in element`, so any event that lives
	// on HTMLElement.prototype should bind. These tests pin that contract for the
	// less-common event surfaces we actually rely on (pointer, wheel, transition,
	// animation, composition) and verify CustomEvent detail flows through the
	// listener untouched.

	test.each([
		["onpointerdown", "pointerdown"],
		["onpointerup", "pointerup"],
		["onwheel", "wheel"],
		["ontransitionend", "transitionend"],
		["onanimationend", "animationend"],
		["oncompositionend", "compositionend"],
		["onfocusin", "focusin"],
		["oncontextmenu", "contextmenu"],
	])(
		"binds %s via addEventListener and fires on %s",
		(attributeKey, eventName) => {
			const element = document.createElement("div");
			// guard: if a future runtime drops one of these from the prototype the
			// fast path would silently fall through to setAttribute and the test
			// would still pass the dispatch check via inline handler, so assert the
			// lookup so a regression surfaces here, not somewhere downstream.
			expect(attributeKey in element).toBe(true);

			const received: Array<Event> = [];
			const handler = (event: Event) => received.push(event);

			applyDynamicAttribute(element, attributeKey, handler);
			expect(element.hasAttribute(attributeKey)).toBe(false);

			const dispatched = new Event(eventName);
			element.dispatchEvent(dispatched);
			expect(received).toEqual([dispatched]);
		},
	);

	test("CustomEvent detail reaches a listener bound to a standard event slot", () => {
		// We don't unwrap the event; the listener gets whatever dispatchEvent
		// hands us. This pins that contract so callers can safely route typed
		// payloads through `oninput`, `onchange`, etc.
		const element = document.createElement("input");
		const received: Array<{ detail: unknown; type: string }> = [];

		applyDynamicAttribute(element, "oninput", (event: Event) => {
			received.push({
				detail: (event as CustomEvent<{ value: number }>).detail,
				type: event.type,
			});
		});

		element.dispatchEvent(new CustomEvent("input", { detail: { value: 42 } }));
		expect(received).toEqual([{ detail: { value: 42 }, type: "input" }]);
	});

	test("bubbling CustomEvent dispatched on a child fires a listener on the parent", () => {
		// Listener registration must not swallow the bubbling phase; events
		// dispatched on a descendant should still reach the ancestor that owns
		// the `on*` binding.
		const parent = document.createElement("section");
		const child = document.createElement("button");
		parent.appendChild(child);

		const received: Array<string> = [];
		applyDynamicAttribute(parent, "onclick", () => received.push("parent"));

		child.dispatchEvent(new CustomEvent("click", { bubbles: true }));
		expect(received).toEqual(["parent"]);
	});

	test("swapping an exotic listener detaches the old one and attaches the new", () => {
		// Same swap semantics as onclick, just on a different event surface.
		// regression guard so the removeEventListener call uses the same
		// (lowercased) event name as the original addEventListener.
		const element = document.createElement("div");
		const received: Array<string> = [];
		const firstHandler = () => received.push("first");
		const secondHandler = () => received.push("second");

		applyDynamicAttribute(element, "onpointerdown", firstHandler);
		applyDynamicAttribute(
			element,
			"onpointerdown",
			secondHandler,
			firstHandler,
		);

		element.dispatchEvent(new Event("pointerdown"));
		expect(received).toEqual(["second"]);
	});

	test("detaches an exotic listener when the new value is null", () => {
		const element = document.createElement("div");
		const received: Array<Event> = [];
		const handler = (event: Event) => received.push(event);

		applyDynamicAttribute(element, "ontransitionend", handler);
		applyDynamicAttribute(element, "ontransitionend", null, handler);

		element.dispatchEvent(new Event("transitionend"));
		expect(received).toEqual([]);
	});

	test("listener bound via mixed-case key still fires on the canonical event", () => {
		// Authoring style varies (onPointerDown, ONWHEEL); the lowercase lookup
		// must match the prototype property and the underlying event name must
		// still be the lowercased remainder.
		const element = document.createElement("div");
		const received: Array<string> = [];

		applyDynamicAttribute(element, "onPointerDown", (event: Event) =>
			received.push(event.type),
		);

		element.dispatchEvent(new Event("pointerdown"));
		expect(received).toEqual(["pointerdown"]);
	});

	test("custom event name with no matching prototype property lands as a JS property, not via addEventListener", () => {
		// `onmycustomevent` isn't on HTMLElement.prototype, so the fast path's
		// `lowerKey in element` guard is false. A function value should fall
		// through to property assignment; what the runtime later does with that
		// property on dispatch is its business, but the binding itself must not
		// have called addEventListener.
		const element = document.createElement("div");
		expect("onmycustomevent" in element).toBe(false);

		const handler = () => {};
		const addSpy = vi.spyOn(element, "addEventListener");

		applyDynamicAttribute(element, "onmycustomevent", handler);

		expect(addSpy).not.toHaveBeenCalled();
		expect(
			(element as unknown as { onmycustomevent: unknown }).onmycustomevent,
		).toBe(handler);
		expect(element.hasAttribute("onmycustomevent")).toBe(false);
	});

	test("removes the listener via null even when only oldValue is a function", () => {
		// On the very first call, value is null but oldValue is a function, so
		// the entry guard in applyDynamicAttribute still has to enter the on* branch
		// so removeEventListener fires for the orphaned handler.
		const element = document.createElement("div");
		const received: Array<Event> = [];
		const handler = (event: Event) => received.push(event);

		element.addEventListener("wheel", handler);
		applyDynamicAttribute(element, "onwheel", null, handler);

		element.dispatchEvent(new Event("wheel"));
		expect(received).toEqual([]);
	});

	test("function → non-function on an event key detaches the listener and writes nothing", () => {
		const element = document.createElement("button");
		const events: Array<string> = [];
		const handler = () => events.push("clicked");

		applyDynamicAttribute(element, "onclick", handler);
		applyDynamicAttribute(element, "onclick", "alert(1)", handler);

		//no live native handler was created, and the old listener is gone
		expect(element.hasAttribute("onclick")).toBe(false);
		element.click();
		expect(events).toEqual([]);
	});

	test("non-function → function on an event key binds once, with no leftover attribute", () => {
		const element = document.createElement("button");
		const events: Array<string> = [];
		const handler = () => events.push("clicked");

		//a string on an event key writes nothing (functions-only, like the static path)
		applyDynamicAttribute(element, "onclick", "alert(1)");
		expect(element.hasAttribute("onclick")).toBe(false);

		applyDynamicAttribute(element, "onclick", handler, "alert(1)");
		expect(element.hasAttribute("onclick")).toBe(false);

		element.click();
		expect(events).toEqual(["clicked"]);
	});
});

describe("applyDynamicAttribute - on- explicit listeners", () => {
	test("binds a custom event with no IDL property, skipping the in-element gate", () => {
		// the whole point of `on-`: `on-form-reset` has no prototype property, so
		// the gated `on*` path would fall through. the dash marks it as a listener
		// unconditionally.
		const element = document.createElement("div");
		expect("on-form-reset" in element).toBe(false);

		const received: Array<string> = [];
		const addSpy = vi.spyOn(element, "addEventListener");

		applyDynamicAttribute(element, "on-form-reset", (event: Event) =>
			received.push(event.type),
		);

		expect(addSpy).toHaveBeenCalledWith("form-reset", expect.any(Function));
		// must not leak as an attribute or a JS property
		expect(element.hasAttribute("on-form-reset")).toBe(false);
		expect(
			(element as unknown as Record<string, unknown>)["on-form-reset"],
		).toBeUndefined();

		element.dispatchEvent(new Event("form-reset"));
		expect(received).toEqual(["form-reset"]);
	});

	test("strips only the `on-` prefix, keeping hyphens in the event name", () => {
		const element = document.createElement("div");
		const received: Array<string> = [];

		applyDynamicAttribute(element, "on-form-state-restore", (event: Event) =>
			received.push(event.type),
		);

		element.dispatchEvent(new Event("form-state-restore"));
		expect(received).toEqual(["form-state-restore"]);
	});

	test("swaps the handler, detaching the old listener", () => {
		const element = document.createElement("div");
		const received: Array<string> = [];
		const first = () => received.push("first");
		const second = () => received.push("second");

		applyDynamicAttribute(element, "on-my-event", first);
		applyDynamicAttribute(element, "on-my-event", second, first);

		element.dispatchEvent(new Event("my-event"));
		expect(received).toEqual(["second"]);
	});

	test("detaches when the value becomes null", () => {
		const element = document.createElement("div");
		const received: Array<Event> = [];
		const handler = (event: Event) => received.push(event);

		applyDynamicAttribute(element, "on-my-event", handler);
		applyDynamicAttribute(element, "on-my-event", null, handler);

		element.dispatchEvent(new Event("my-event"));
		expect(received).toEqual([]);
	});

	test("lowercases the event name, matching the DOM's attribute-name folding", () => {
		// declarative event names can't preserve case (the DOM lowercases attribute
		// names), so `on-` follows the same rule: the listener binds to the
		// lowercased remainder. case-sensitive types need imperative addEventListener.
		const element = document.createElement("div");
		const received: Array<string> = [];

		applyDynamicAttribute(element, "on-MyEvent", (event: Event) =>
			received.push(event.type),
		);

		element.dispatchEvent(new Event("myevent"));
		expect(received).toEqual(["myevent"]);
	});
});

describe("applyDynamicAttribute - dead native handler warning", () => {
	test("warns when an on<name> function value finds no matching IDL property", () => {
		// onClik is a typo'd onClick: no `onclik` IDL property, so the function
		// would land as a dead property that never fires. that must be loud.
		const element = document.createElement("button");
		expect("onclik" in element).toBe(false);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		applyDynamicAttribute(element, "onClik", () => {});

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain("onClik");
		warn.mockRestore();
	});

	test("does not warn for a correctly spelled native handler", () => {
		const element = document.createElement("button");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		applyDynamicAttribute(element, "onclick", () => {});

		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	test("does not warn for an on-<name> explicit custom-event listener", () => {
		// on-<name> is the intended way to bind a no-IDL custom event, so it must
		// never trip the dead-handler warning.
		const element = document.createElement("div");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		applyDynamicAttribute(element, "on-whatever", () => {});

		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	test("does not warn for a non-on* name carrying a function", () => {
		const element = document.createElement("div");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		applyDynamicAttribute(element, "data-thing", () => {});

		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	test("does not warn again on teardown when only oldValue is a function", () => {
		// a dead handler warns once on apply; tearing it down (value null,
		// oldValue function) must stay silent.
		const element = document.createElement("div");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		applyDynamicAttribute(element, "onmadeup", null, () => {});

		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe("applyDynamicAttribute - removal", () => {
	test.each([
		["null", null],
		["undefined", undefined],
		["false", false],
	])("removes the attribute when value is %s", (_label, value) => {
		const element = document.createElement("div");
		element.setAttribute("title", "previous");

		applyDynamicAttribute(element, "title", value);
		expect(element.hasAttribute("title")).toBe(false);
	});
});

describe("applyDynamicAttribute - stringable values", () => {
	test("sets a string attribute", () => {
		const element = document.createElement("div");
		applyDynamicAttribute(element, "title", "hello");
		expect(element.getAttribute("title")).toBe("hello");
	});

	test("coerces a number to a string attribute", () => {
		const element = document.createElement("input");
		applyDynamicAttribute(element, "tabindex", 5);
		expect(element.getAttribute("tabindex")).toBe("5");
	});

	test("coerces boolean true to the literal string 'true'", () => {
		// Matches the integration test "sets boolean true as empty attribute":
		// String(true) === "true", and that's what lands on the attribute.
		const element = document.createElement("button");
		applyDynamicAttribute(element, "disabled", true);
		expect(element.getAttribute("disabled")).toBe("true");
	});

	test("empty string is preserved as a present-but-empty attribute", () => {
		const element = document.createElement("div");
		applyDynamicAttribute(element, "title", "");
		expect(element.hasAttribute("title")).toBe(true);
		expect(element.getAttribute("title")).toBe("");
	});

	test("transition from non-stringable oldValue to stringable value clears the JS property", () => {
		// The JS property previously set for a complex
		// value must be deleted so the attribute side becomes the source of
		// truth. Without this, the element keeps a stale property reference.
		const element = document.createElement("div");
		const previous = { nested: 1 };

		applyDynamicAttribute(element, "data", previous);
		expect((element as unknown as { data: unknown }).data).toBe(previous);

		applyDynamicAttribute(element, "data", "plain", previous);
		expect(element.getAttribute("data")).toBe("plain");
		expect(Object.prototype.hasOwnProperty.call(element, "data")).toBe(false);
	});
});

describe("applyDynamicAttribute - non-stringable values", () => {
	test("assigns a complex value as a JS property without setting the attribute", () => {
		const element = document.createElement("div");
		const payload = { nested: { value: 1 } };

		applyDynamicAttribute(element, "data", payload);
		expect((element as unknown as { data: unknown }).data).toBe(payload);
		expect(element.hasAttribute("data")).toBe(false);
	});

	test("assigns an array as a JS property", () => {
		const element = document.createElement("div");
		const items = [1, 2, 3];

		applyDynamicAttribute(element, "items", items);
		expect((element as unknown as { items: unknown }).items).toBe(items);
	});

	test("removing a property-mode entry deletes the JS property (not just the attribute)", () => {
		const element = document.createElement("div");
		const items = [1, 2, 3];

		applyDynamicAttribute(element, "items", items);
		applyDynamicAttribute(element, "items", null, items);

		expect("items" in element).toBe(false);
		expect((element as unknown as { items: unknown }).items).toBeUndefined();
	});

	test("calls update() when the receiver exposes one (custom-element handoff)", () => {
		// When the target has an update() method, we trigger
		// it so a custom element can react to the new property. This is the
		// component-to-component data flow path.
		const element = document.createElement("div") as HTMLDivElement & {
			update?: () => void;
		};
		const updateSpy = vi.fn();
		element.update = updateSpy;

		applyDynamicAttribute(element, "config", { nested: 1 });
		expect(updateSpy).toHaveBeenCalledTimes(1);
	});

	test("does not call update() for stringable values", () => {
		// The update() trigger lives only on the property-assignment branch.
		// Plain attribute writes must not fire it; otherwise every attribute
		// flip on a child component would cause it to re-render twice.
		const element = document.createElement("div") as HTMLDivElement & {
			update?: () => void;
		};
		const updateSpy = vi.fn();
		element.update = updateSpy;

		applyDynamicAttribute(element, "title", "hello");
		expect(updateSpy).not.toHaveBeenCalled();
	});
});

describe("applyDynamicAttribute - stringable to non-stringable transition", () => {
	//we previously wrote the stringable value as a real attribute (line 49 in attribute.ts); now the new value is non-stringable, so the code assigns to the JS property
	//=> nothing removes the prior attribute, which means a child custom element reading `getAttribute("config")` after the transition still sees the stale stringified previous value
	//these tests document the current behavior so the user can decide whether the missing removeAttribute call is intentional or a latent bug
	test("the JS property reflects the new non-stringable value", () => {
		const element = document.createElement("div");
		const payload = { nested: 1 };

		applyDynamicAttribute(element, "config", "previous-string");
		applyDynamicAttribute(element, "config", payload, "previous-string");

		expect((element as unknown as { config: unknown }).config).toBe(payload);
	});

	test("the prior stringable attribute remains on the element after the transition", () => {
		//this is the asymmetric half: the matching non-stringable → stringable transition does `delete element[key]` to remove the property (covered by the existing "transition from non-stringable oldValue to stringable value" test).
		//going the other direction leaves the attribute behind. If this surprises a future caller, the fix is a `removeAttribute(key)` in the else branch of attribute.ts before the property assignment.
		const element = document.createElement("div");

		applyDynamicAttribute(element, "config", "previous-string");
		expect(element.getAttribute("config")).toBe("previous-string");

		applyDynamicAttribute(element, "config", { nested: 1 }, "previous-string");
		expect(element.getAttribute("config")).toBe("previous-string");
	});

	test("update() still fires on the property-assignment branch after the transition", () => {
		//the update() trigger should still run for the non-stringable side even when there was a prior stringable value
		const element = document.createElement("div") as HTMLDivElement & {
			update?: () => void;
		};
		const updateSpy = vi.fn();
		element.update = updateSpy;

		applyDynamicAttribute(element, "config", "before");
		expect(updateSpy).not.toHaveBeenCalled();

		applyDynamicAttribute(element, "config", { x: 1 }, "before");
		expect(updateSpy).toHaveBeenCalledTimes(1);
	});
});

describe("normalizeToAttributeMap - scalar bare value", () => {
	test("a non-empty string is a single boolean attribute name", () => {
		expect([...normalizeToAttributeMap("disabled")]).toEqual([["disabled", ""]]);
	});

	test("an empty string yields no attribute — the conditional-boolean idiom", () => {
		//`${cond ? "" : "disabled"}` must produce no attribute in the empty branch,
		//never setAttribute("", "") which throws InvalidCharacterError
		expect(normalizeToAttributeMap("").size).toBe(0);
	});

	test("falsy scalars (false, null, undefined, 0) yield no attribute", () => {
		expect(normalizeToAttributeMap(false).size).toBe(0);
		expect(normalizeToAttributeMap(null).size).toBe(0);
		expect(normalizeToAttributeMap(undefined).size).toBe(0);
		expect(normalizeToAttributeMap(0).size).toBe(0);
	});

	test("an array of names becomes one boolean attribute each", () => {
		expect([...normalizeToAttributeMap(["disabled", "hidden"])]).toEqual([
			["disabled", ""],
			["hidden", ""],
		]);
	});

	test("a plain object maps names to their values", () => {
		expect([...normalizeToAttributeMap({ id: "x", tabindex: 0 })]).toEqual([
			["id", "x"],
			["tabindex", 0],
		]);
	});
});
