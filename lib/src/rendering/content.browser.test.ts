import {describe, expect, test} from "vitest";
import {html, render} from "../index";

const sleep = (duration = 0) =>
    new Promise((resolve) => setTimeout(resolve, duration));

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

        const textNode = p.childNodes[1];

        text = "after";
        await element.update();
        await sleep();

        expect(p.textContent).toContain("after");
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
