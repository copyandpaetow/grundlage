import {describe, expect, test} from "vitest";
import {html, render} from "../index";

const sleep = (duration = 0) =>
    new Promise((resolve) => setTimeout(resolve, duration));

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
            yield () => html`
                <button ${attrs}>click</button>`;
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
            yield () => html`
                <div ${attrs}>content</div>`;
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
            yield () => html`
                <button ${attrs}>click</button>`;
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
