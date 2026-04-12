import {describe, expect, test} from "vitest";
import {html, render} from "./index";

const sleep = (duration = 0) =>
    new Promise((resolve) => setTimeout(resolve, duration));

describe("component lifecycle", () => {
    let tagId = 0;

    const uniqueTag = () => `test-lifecycle-${tagId++}-${Date.now()}`;

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

        await sleep();

        expect(cleaned).toBe(true);
    });
});
