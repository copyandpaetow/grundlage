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

    test("renders null as empty text", async () => {
        const tag = uniqueTag();
        let value: unknown = null;

        const MyElement = render(function* () {
            yield () => html`<p>${value}</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const p = element.shadowRoot?.querySelector("p")!;
        expect(p.textContent).toBe("");

        cleanup(element);
    });

    test("renders undefined as empty text", async () => {
        const tag = uniqueTag();
        let value: unknown = undefined;

        const MyElement = render(function* () {
            yield () => html`<p>${value}</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const p = element.shadowRoot?.querySelector("p")!;
        expect(p.textContent).toBe("");

        cleanup(element);
    });

    test("renders false as empty text", async () => {
        const tag = uniqueTag();
        let value: unknown = false;

        const MyElement = render(function* () {
            yield () => html`<p>${value}</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const p = element.shadowRoot?.querySelector("p")!;
        expect(p.textContent).toBe("false");

        cleanup(element);
    });

    test("renders boolean true as text", async () => {
        const tag = uniqueTag();

        const MyElement = render(function* () {
            yield () => html`<p>${true}</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const p = element.shadowRoot?.querySelector("p")!;
        expect(p.textContent).toBe("true");

        cleanup(element);
    });

    test("renders a number as text", async () => {
        const tag = uniqueTag();

        const MyElement = render(function* () {
            yield () => html`<p>${42}</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const p = element.shadowRoot?.querySelector("p")!;
        expect(p.textContent).toBe("42");

        cleanup(element);
    });

    test("renders zero as text", async () => {
        const tag = uniqueTag();

        const MyElement = render(function* () {
            yield () => html`<p>${0}</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const p = element.shadowRoot?.querySelector("p")!;
        expect(p.textContent).toBe("0");

        cleanup(element);
    });

    test("switches from text to nested template", async () => {
        const tag = uniqueTag();
        let useTemplate = false;

        const MyElement = render(function* () {
            yield () =>
                html`<div>${
                    useTemplate ? html`<span>nested</span>` : "plain text"
                }</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(
            element.shadowRoot?.querySelector("div")?.textContent,
        ).toContain("plain text");
        expect(element.shadowRoot?.querySelector("span")).toBeNull();

        useTemplate = true;
        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
            "nested",
        );

        cleanup(element);
    });

    test("switches from nested template to text", async () => {
        const tag = uniqueTag();
        let useTemplate = true;

        const MyElement = render(function* () {
            yield () =>
                html`<div>${
                    useTemplate ? html`<span>nested</span>` : "plain text"
                }</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
            "nested",
        );

        useTemplate = false;
        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelector("span")).toBeNull();
        expect(
            element.shadowRoot?.querySelector("div")?.textContent,
        ).toContain("plain text");

        cleanup(element);
    });

    test("switches from text to array", async () => {
        const tag = uniqueTag();
        let useArray = false;

        const MyElement = render(function* () {
            yield () =>
                html`<div>${
                    useArray
                        ? ["a", "b"].map((i) => html`<span>${i}</span>`)
                        : "single"
                }</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(
            element.shadowRoot?.querySelector("div")?.textContent,
        ).toContain("single");

        useArray = true;
        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelectorAll("span").length).toBe(2);

        cleanup(element);
    });

    test("switches from array to text", async () => {
        const tag = uniqueTag();
        let useArray = true;

        const MyElement = render(function* () {
            yield () =>
                html`<div>${
                    useArray
                        ? ["a", "b"].map((i) => html`<span>${i}</span>`)
                        : "single"
                }</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(element.shadowRoot?.querySelectorAll("span").length).toBe(2);

        useArray = false;
        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelectorAll("span").length).toBe(0);
        expect(
            element.shadowRoot?.querySelector("div")?.textContent,
        ).toContain("single");

        cleanup(element);
    });

    test("renders an empty array without error", async () => {
        const tag = uniqueTag();
        let items: string[] = [];

        const MyElement = render(function* () {
            yield () =>
                html`<div>${items.map((i) => html`<span>${i}</span>`)}</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(element.shadowRoot?.querySelectorAll("span").length).toBe(0);

        items = ["a"];
        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelectorAll("span").length).toBe(1);

        items = [];
        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelectorAll("span").length).toBe(0);

        cleanup(element);
    });

    test("renders deeply nested templates", async () => {
        const tag = uniqueTag();
        let inner = "deep";

        const MyElement = render(function* () {
            yield () =>
                html`<div>${html`<section>${html`<p>${inner}</p>`}</section>`}</div>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
            "deep",
        );

        inner = "deeper";
        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
            "deeper",
        );

        cleanup(element);
    });

    test("reorders list items efficiently", async () => {
        const tag = uniqueTag();
        let items = [
            {id: 1, text: "one"},
            {id: 2, text: "two"},
            {id: 3, text: "three"},
        ];

        const MyElement = render(function* () {
            yield () =>
                html`<ul>${items.map(
                    (i) => html`<li>${i.text}</li>`,
                )}</ul>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const lis = element.shadowRoot?.querySelectorAll("li")!;
        expect(lis.length).toBe(3);
        expect(lis[0].textContent).toContain("one");

        // Reverse the order
        items = [
            {id: 3, text: "three"},
            {id: 2, text: "two"},
            {id: 1, text: "one"},
        ];
        await element.update();
        await sleep();

        const updated = element.shadowRoot?.querySelectorAll("li")!;
        expect(updated.length).toBe(3);
        expect(updated[0].textContent).toContain("three");
        expect(updated[1].textContent).toContain("two");
        expect(updated[2].textContent).toContain("one");

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

    test("updates text content when a decimal value changes", async () => {
        const tag = uniqueTag();
        let value = 1.5;

        const MyElement = render(function* () {
            yield () => html`<p>${value}</p>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const paragraph = element.shadowRoot?.querySelector("p")!;
        expect(paragraph.textContent).toContain("1.5");

        value = 1.7;
        await element.update();
        await sleep();
        expect(paragraph.textContent).toContain("1.7");

        value = 1.70001;
        await element.update();
        await sleep();
        expect(paragraph.textContent).toContain("1.70001");

        value = 2.3;
        await element.update();
        await sleep();
        expect(paragraph.textContent).toContain("2.3");

        cleanup(element);
    });

    test("batches rapid updates into a single render and reflects the final value", async () => {
        const tag = uniqueTag();
        let value = 0;
        let renderCount = 0;

        const MyElement = render(function* () {
            yield () => {
                renderCount++;
                return html`<p>${value}</p>`;
            };
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const paragraph = element.shadowRoot?.querySelector("p")!;
        const textNode = paragraph.childNodes[1];
        expect(paragraph.textContent).toContain("0");

        const baselineRenderCount = renderCount;

        for (let index = 1; index <= 25; index++) {
            value = index;
            element.update();
        }

        await sleep();

        expect(paragraph.textContent).toContain("25");
        expect(paragraph.childNodes[1]).toBe(textNode);
        expect(renderCount - baselineRenderCount).toBe(1);

        value = 26;
        element.update();
        value = 27;
        element.update();
        value = 28;
        element.update();
        await sleep();

        expect(paragraph.textContent).toContain("28");
        expect(renderCount - baselineRenderCount).toBe(2);

        cleanup(element);
    });
});
