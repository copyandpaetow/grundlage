import {describe, expect, test} from "vitest";
import {html, render} from "./index";

const sleep = (duration = 0) =>
    new Promise((resolve) => setTimeout(resolve, duration));

describe("component lifecycle", () => {
    let tagId = 0;

    /** generates a unique tag name per test to avoid collisions from customElements.define */
    const uniqueTag = () => `test-el-${tagId++}-${Date.now()}`;

    const mount = (tag: string): HTMLElement => {
        const element = document.createElement(tag);
        document.body.appendChild(element);
        return element;
    };

    const cleanup = (element: HTMLElement) => {
        element.remove();
    };

    test("mounts and renders into shadow DOM", async () => {
        const tag = uniqueTag();

        const MyElement = render(function* () {
            yield () => html`<p>hello</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag);

        // wait for connectedCallback + initial render
        await sleep();

        const p = element.shadowRoot?.querySelector("p");
        expect(p).not.toBeNull();
        expect(p?.textContent).toBe("hello");

        cleanup(element);
    });

    test("update() re-renders with new state", async () => {
        const tag = uniqueTag();
        let count = 0;

        const Counter = render(function* () {
            yield () => html`<span>${count}</span>`;
        });

        customElements.define(tag, Counter);
        const element = mount(tag) as InstanceType<typeof Counter>;

        await sleep();
        expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
            "0",
        );

        count = 5;
        await element.update();
        // update batches via microtask, wait for it to flush
        await sleep();

        expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
            "5",
        );

        cleanup(element);
    });

    test("disconnectedCallback cleans up", async () => {
        const tag = uniqueTag();
        let cleaned = false;

        const MyElement = render(function* () {
            yield () => html`<p>temp</p>`;
            return () => {
                cleaned = true;
            };
        });

        customElements.define(tag, MyElement);
        const element = mount(tag);

        await sleep();
        cleanup(element);

        // disconnectedCallback waits a microtask before cleanup
        await sleep();

        expect(cleaned).toBe(true);
    });
});

describe("attribute updates", () => {
    let tagId = 0;
    const uniqueTag = () => `test-attr-${tagId++}-${Date.now()}`;

    const mount = (tag: string): HTMLElement => {
        const element = document.createElement(tag);
        document.body.appendChild(element);
        return element;
    };

    const cleanup = (element: HTMLElement) => {
        element.remove();
    };

    test("updates a dynamic attribute value", async () => {
        const tag = uniqueTag();
        let cls = "red";

        const MyElement = render(function* () {
            yield () => html`
                <div class="${cls}"></div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(
            element.shadowRoot?.querySelector("div")?.getAttribute("class"),
        ).toBe("red");

        cls = "blue";
        await element.update();
        await sleep();

        expect(
            element.shadowRoot?.querySelector("div")?.getAttribute("class"),
        ).toBe("blue");

        cleanup(element);
    });

    test("updates a multi-part attribute", async () => {
        const tag = uniqueTag();
        let first = "hello";
        let second = "world";

        const MyElement = render(function* () {
            yield () => html`
                <div class="${first} ${second}"></div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(
            element.shadowRoot?.querySelector("div")?.getAttribute("class"),
        ).toBe("hello world");

        first = "foo";
        await element.update();
        await sleep();

        expect(
            element.shadowRoot?.querySelector("div")?.getAttribute("class"),
        ).toBe("foo world");

        cleanup(element);
    });

    test("toggles a boolean attribute", async () => {
        const tag = uniqueTag();
        let disabled = true;

        const MyElement = render(function* () {
            yield () =>
                html`
                    <button disabled="${disabled}">click</button>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const btn = element.shadowRoot?.querySelector("button");
        expect(btn?.hasAttribute("disabled")).toBe(true);

        disabled = false;
        await element.update();
        await sleep();

        expect(btn?.hasAttribute("disabled")).toBe(false);

        cleanup(element);
    });

    test("registers and updates event listeners", async () => {
        const tag = uniqueTag();
        const clicks: string[] = [];
        let handler = () => clicks.push("first");

        const MyElement = render(function* () {
            yield () => html`
                <button onclick="${handler}">click</button>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const btn = element.shadowRoot?.querySelector("button")!;
        btn.click();
        expect(clicks).toEqual(["first"]);

        handler = () => clicks.push("second");
        await element.update();
        await sleep();

        btn.click();
        expect(clicks).toEqual(["first", "second"]);

        cleanup(element);
    });

    test("expands an array into boolean attributes", async () => {
        const tag = uniqueTag();
        let attrs = ["disabled", "hidden"];

        const MyElement = render(function* () {
            yield () => html`<button ${attrs}>click</button>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const btn = element.shadowRoot?.querySelector("button")!;
        expect(btn.hasAttribute("disabled")).toBe(true);
        expect(btn.hasAttribute("hidden")).toBe(true);

        attrs = ["hidden"];
        await element.update();
        await sleep();

        expect(btn.hasAttribute("disabled")).toBe(false);
        expect(btn.hasAttribute("hidden")).toBe(true);

        cleanup(element);
    });

    test("expands an object into key-value attributes", async () => {
        const tag = uniqueTag();
        let attrs: Record<string, string> = {class: "red", id: "main"};

        const MyElement = render(function* () {
            yield () => html`<div ${attrs}>content</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const div = element.shadowRoot?.querySelector("div")!;
        expect(div.getAttribute("class")).toBe("red");
        expect(div.getAttribute("id")).toBe("main");

        attrs = {class: "blue", title: "hello"};
        await element.update();
        await sleep();

        expect(div.getAttribute("class")).toBe("blue");
        expect(div.hasAttribute("id")).toBe(false);
        expect(div.getAttribute("title")).toBe("hello");

        cleanup(element);
    });

    test("switches from array to object expandable attributes", async () => {
        const tag = uniqueTag();
        let attrs: string[] | Record<string, string> = ["disabled"];

        const MyElement = render(function* () {
            yield () => html`<button ${attrs}>click</button>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const btn = element.shadowRoot?.querySelector("button")!;
        expect(btn.hasAttribute("disabled")).toBe(true);

        attrs = {class: "primary"};
        await element.update();
        await sleep();

        expect(btn.hasAttribute("disabled")).toBe(false);
        expect(btn.getAttribute("class")).toBe("primary");

        cleanup(element);
    });
});

describe("content updates", () => {
    let tagId = 0;
    const uniqueTag = () => `test-content-${tagId++}-${Date.now()}`;

    const mount = (tag: string): HTMLElement => {
        const element = document.createElement(tag);
        document.body.appendChild(element);
        return element;
    };

    const cleanup = (element: HTMLElement) => {
        element.remove();
    };

    test("updates text content without replacing the text node", async () => {
        const tag = uniqueTag();
        let text = "before";

        const MyElement = render(function* () {
            yield () => html`<p>${text}</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const p = element.shadowRoot?.querySelector("p")!;
        expect(p.textContent).toContain("before");

        // grab reference to the text node to verify it's reused
        const textNode = p.childNodes[1];

        text = "after";
        await element.update();
        await sleep();

        expect(p.textContent).toContain("after");
        // same text node should be reused (no DOM teardown)
        expect(p.childNodes[1]).toBe(textNode);

        cleanup(element);
    });

    test("renders a nested template and updates it in-place", async () => {
        const tag = uniqueTag();
        let inner = "child-v1";

        const MyElement = render(function* () {
            yield () => html`
                <div>${html`<span>${inner}</span>`}</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const span = element.shadowRoot?.querySelector("span")!;
        expect(span.textContent).toContain("child-v1");

        inner = "child-v2";
        await element.update();
        await sleep();

        // same span element should be reused (template structure unchanged)
        expect(element.shadowRoot?.querySelector("span")).toBe(span);
        expect(span.textContent).toContain("child-v2");

        cleanup(element);
    });

    test("renders and updates a list", async () => {
        const tag = uniqueTag();
        let items = ["a", "b", "c"];

        const MyElement = render(function* () {
            yield () => html`
                <ul>${items.map((i) => html`
                    <li>${i}</li>`)}
                </ul>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const lis = element.shadowRoot?.querySelectorAll("li")!;
        expect(lis.length).toBe(3);
        expect(lis[0].textContent).toContain("a");
        expect(lis[1].textContent).toContain("b");
        expect(lis[2].textContent).toContain("c");

        items = ["a", "c", "d"];
        await element.update();
        await sleep();

        const updated = element.shadowRoot?.querySelectorAll("li")!;
        expect(updated.length).toBe(3);
        expect(updated[0].textContent).toContain("a");
        expect(updated[1].textContent).toContain("c");
        expect(updated[2].textContent).toContain("d");

        cleanup(element);
    });

    test("grows and shrinks a list", async () => {
        const tag = uniqueTag();
        let items = ["x"];

        const MyElement = render(function* () {
            yield () =>
                html`
                    <div>${items.map((i) => html`<span>${i}</span>`)}</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(element.shadowRoot?.querySelectorAll("span").length).toBe(1);

        items = ["x", "y", "z"];
        await element.update();
        await sleep();
        expect(element.shadowRoot?.querySelectorAll("span").length).toBe(3);

        items = ["z"];
        await element.update();
        await sleep();
        expect(element.shadowRoot?.querySelectorAll("span").length).toBe(1);
        expect(
            element.shadowRoot?.querySelector("span")?.textContent,
        ).toContain("z");

        cleanup(element);
    });
});

describe("template switching", () => {
    let tagId = 0;
    const uniqueTag = () => `test-switch-${tagId++}-${Date.now()}`;

    const mount = (tag: string): HTMLElement => {
        const element = document.createElement(tag);
        document.body.appendChild(element);
        return element;
    };

    const cleanup = (element: HTMLElement) => {
        element.remove();
    };

    test("switches between different template structures", async () => {
        const tag = uniqueTag();
        let showFirst = true;

        const MyElement = render(function* () {
            yield () =>
                showFirst
                    ? html`
                            <div>first</div>`
                    : html`<span>second</span>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(element.shadowRoot?.querySelector("div")?.textContent).toBe(
            "first",
        );
        expect(element.shadowRoot?.querySelector("span")).toBeNull();

        showFirst = false;
        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelector("div")).toBeNull();
        expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
            "second",
        );

        cleanup(element);
    });
});

describe("multiple bindings", () => {
    let tagId = 0;
    const uniqueTag = () => `test-multi-${tagId++}-${Date.now()}`;

    const mount = (tag: string): HTMLElement => {
        const element = document.createElement(tag);
        document.body.appendChild(element);
        return element;
    };

    const cleanup = (element: HTMLElement) => {
        element.remove();
    };

    test("updates only the changed binding among many", async () => {
        const tag = uniqueTag();
        let a = "alpha";
        let b = "beta";
        let c = "gamma";

        const MyElement = render(function* () {
            yield () =>
                html`<p>${a}</p>
                <p>${b}</p>
                <p>${c}</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const ps = element.shadowRoot?.querySelectorAll("p")!;
        expect(ps[0].textContent).toContain("alpha");
        expect(ps[1].textContent).toContain("beta");
        expect(ps[2].textContent).toContain("gamma");

        // only change the middle one
        b = "BETA";
        await element.update();
        await sleep();

        const updated = element.shadowRoot?.querySelectorAll("p")!;
        expect(updated[0].textContent).toContain("alpha");
        expect(updated[1].textContent).toContain("BETA");
        expect(updated[2].textContent).toContain("gamma");

        cleanup(element);
    });

    test("handles mixed binding types in one template", async () => {
        const tag = uniqueTag();
        let cls = "highlight";
        let text = "content";
        let handler = () => {
        };

        const MyElement = render(function* () {
            yield () =>
                html`
                    <div class="${cls}" onclick="${handler}">${text}</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const div = element.shadowRoot?.querySelector("div")!;
        expect(div.getAttribute("class")).toBe("highlight");
        expect(div.textContent).toContain("content");

        cls = "dim";
        text = "updated";
        await element.update();
        await sleep();

        expect(div.getAttribute("class")).toBe("dim");
        expect(div.textContent).toContain("updated");

        cleanup(element);
    });

    test("rapid sequential updates coalesce into one render", async () => {
        const tag = uniqueTag();
        let value = 0;
        let renderCount = 0;

        const MyElement = render(function* () {
            yield () => {
                renderCount++;
                return html`<span>${value}</span>`;
            };
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const initialRenders = renderCount;

        value = 1;
        element.update();
        value = 2;
        element.update();
        value = 3;
        element.update();

        await sleep();

        // only one render should have happened despite three update() calls
        expect(renderCount).toBe(initialRenders + 1);
        expect(
            element.shadowRoot?.querySelector("span")?.textContent,
        ).toContain("3");

        cleanup(element);
    });
});
