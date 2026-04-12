import {describe, expect, test} from "vitest";
import {html, render} from "../index";

const sleep = (duration = 0) =>
    new Promise((resolve) => setTimeout(resolve, duration));

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
