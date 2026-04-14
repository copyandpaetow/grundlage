import {describe, expect, test} from "vitest";
import {html, render} from "../index";

const sleep = (duration = 0) =>
    new Promise((resolve) => setTimeout(resolve, duration));

describe("tag updates", () => {
    let tagId = 0;
    const uniqueTag = () => `test-tag-${tagId++}-${Date.now()}`;

    const mount = (tag: string): HTMLElement => {
        const element = document.createElement(tag);
        document.body.appendChild(element);
        return element;
    };

    const cleanup = (element: HTMLElement) => {
        element.remove();
    };

    test("renders a dynamic tag name", async () => {
        const tag = uniqueTag();
        let tagName = "div";

        const MyElement = render(function* () {
            yield () => html`
                <${tagName}>hello</${tagName}>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const child = element.shadowRoot?.querySelector("div");
        expect(child).not.toBeNull();
        expect(child?.textContent).toBe("hello");

        cleanup(element);
    });

    test("switches the tag name and preserves content", async () => {
        const tag = uniqueTag();
        let tagName = "div";

        const MyElement = render(function* () {
            yield () => html`
                <${tagName}>content</${tagName}>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(element.shadowRoot?.querySelector("div")).not.toBeNull();

        tagName = "span";
        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelector("div")).toBeNull();
        const span = element.shadowRoot?.querySelector("span");
        expect(span).not.toBeNull();
        expect(span?.textContent).toBe("content");

        cleanup(element);
    });

    test("preserves attributes when switching tags", async () => {
        const tag = uniqueTag();
        let tagName = "div";

        const MyElement = render(function* () {
            yield () => html`
                <${tagName} class="box" id="main">text</${tagName}>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const div = element.shadowRoot?.querySelector("div")!;
        expect(div.getAttribute("class")).toBe("box");
        expect(div.getAttribute("id")).toBe("main");

        tagName = "section";
        await element.update();
        await sleep();

        const section = element.shadowRoot?.querySelector("section")!;
        expect(section).not.toBeNull();
        expect(section.getAttribute("class")).toBe("box");
        expect(section.getAttribute("id")).toBe("main");

        cleanup(element);
    });

    test("preserves child nodes when switching tags", async () => {
        const tag = uniqueTag();
        let tagName = "div";

        const MyElement = render(function* () {
            yield () =>
                html`
                    <${tagName}><span>child1</span><span>child2</span></${tagName}>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const div = element.shadowRoot?.querySelector("div")!;
        expect(div.querySelectorAll("span").length).toBe(2);
     
        tagName = "article";
        await element.update();
        await sleep();

        const article = element.shadowRoot?.querySelector("article")!;
        expect(article).not.toBeNull();
        expect(article.querySelectorAll("span").length).toBe(2);
        expect(article.querySelector("span")?.textContent).toBe("child1");

        cleanup(element);
    });

    test("re-attaches event listeners after tag switch", async () => {
        const tag = uniqueTag();
        let tagName = "button";
        const clicks: string[] = [];
        const handler = () => clicks.push("clicked");

        const MyElement = render(function* () {
            yield () =>
                html`
                    <${tagName} onclick="${handler}">click me</${tagName}>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const btn = element.shadowRoot?.querySelector("button")!;
        btn.click();
        expect(clicks).toEqual(["clicked"]);

        tagName = "div";
        await element.update();
        await sleep();

        const div = element.shadowRoot?.querySelector("div")!;
        div.click();
        expect(clicks).toEqual(["clicked", "clicked"]);

        cleanup(element);
    });

    test.skipIf("happyDOM" in globalThis)("preserves focus when switching tags with focused child", async () => {
        const tag = uniqueTag();
        let tagName = "div";

        const MyElement = render(function* () {
            yield () =>
                html`
                    <${tagName}><input type="text"/></${tagName}>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const input = element.shadowRoot?.querySelector("input")!;
        input.focus();
        expect(element.shadowRoot?.activeElement).toBe(input);

        tagName = "section";
        await element.update();
        await sleep();

        const newInput = element.shadowRoot?.querySelector("input")!;
        expect(newInput).not.toBeNull();
        expect(element.shadowRoot?.activeElement).toBe(newInput);

        cleanup(element);
    });

    test("does not replace element when tag name is unchanged", async () => {
        const tag = uniqueTag();
        const tagName = "div";

        const MyElement = render(function* () {
            yield () => html`
                <${tagName}>stable</${tagName}>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        const div = element.shadowRoot?.querySelector("div")!;

        await element.update();
        await sleep();

        expect(element.shadowRoot?.querySelector("div")).toBe(div);

        cleanup(element);
    });

    test("switches between multiple tag names", async () => {
        const tag = uniqueTag();
        let tagName = "h1";

        const MyElement = render(function* () {
            yield () => html`
                <${tagName}>heading</${tagName}>`;
        });

        customElements.define(tag, MyElement);
        const element = mount(tag) as InstanceType<typeof MyElement>;
        await sleep();

        expect(element.shadowRoot?.querySelector("h1")).not.toBeNull();

        tagName = "h2";
        await element.update();
        await sleep();
        expect(element.shadowRoot?.querySelector("h2")).not.toBeNull();
        expect(element.shadowRoot?.querySelector("h1")).toBeNull();

        tagName = "h3";
        await element.update();
        await sleep();
        expect(element.shadowRoot?.querySelector("h3")).not.toBeNull();
        expect(element.shadowRoot?.querySelector("h2")).toBeNull();
        expect(element.shadowRoot?.querySelector("h3")?.textContent).toBe(
            "heading",
        );

        cleanup(element);
    });
});
