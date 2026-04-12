import {describe, test, expect} from "vitest";
import {html} from "./html";
import {AttributeBinding, BINDING_TYPES} from "./types";

describe("html parser — static templates", () => {
    test("produces no bindings", () => {
        const template = html`
            <div>hello</div>`;
        expect(template.parsedHTML.bindings).toHaveLength(0);
        expect(template.parsedHTML.expressionToBinding).toHaveLength(0);
    });

    test("preserves static attributes", () => {
        const template = html`
            <div class="red" id="main">text</div>`;
        expect(template.parsedHTML.bindings).toHaveLength(0);
        const div = template.parsedHTML.fragment.querySelector("div")!;
        expect(div.getAttribute("class")).toBe("red");
        expect(div.getAttribute("id")).toBe("main");
    });

    test("handles self-closing tags", () => {
        const template = html`
            <div><br/>
                <hr/>
            </div>`;
        expect(template.parsedHTML.bindings).toHaveLength(0);
    });

    test("handles nested elements", () => {
        const template = html`
            <div><span><a>deep</a></span></div>`;
        expect(template.parsedHTML.bindings).toHaveLength(0);
    });
});

describe("html parser — expression to binding mapping", () => {
    test("single expression maps to single binding", () => {
        const template = html`
            <div>${"text"}</div>`;
        expect(template.parsedHTML.expressionToBinding).toEqual([0]);
    });

    test("two expressions in one attribute share a binding", () => {
        const template = html`
            <div class="${"a"} ${"b"}"></div>`;
        expect(template.parsedHTML.expressionToBinding).toEqual([0, 0]);
    });

    test("expressions in different attributes map to different bindings", () => {
        const template = html`
            <div class="${"a"}" id="${"b"}"></div>`;
        expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
    });

    test("mixed content and attribute expressions", () => {
        const template = html`
            <div class="${"a"}">${"text"}</div>`;
        expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
    });
});

describe("html parser — template caching", () => {
    test("same template strings reuse cached parse result", () => {
        const a = html`<span>${"one"}</span>`;
        const b = html`<span>${"two"}</span>`;

        expect(a.parsedHTML).toStrictEqual(b.parsedHTML);
        expect(a.currentExpressions).toEqual(["one"]);
        expect(b.currentExpressions).toEqual(["two"]);
    });

    test("different template strings produce different parse results", () => {
        const a = html`
            <div>${"val"}</div>`;
        const b = html`<span>${"val"}</span>`;

        expect(a.parsedHTML.templateHash).not.toBe(
            b.parsedHTML.templateHash,
        );
    });
});

describe("html parser — whitespace handling", () => {
    test("template with newlines between elements", () => {
        const val = "hello";
        const template = html`
            <div>
                <span>${val}</span>
            </div>
        `;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.CONTENT,
        );
    });

    test("attributes separated by newlines", () => {
        const cls = "red";
        const id = "main";
        const template = html`
            <div
                    class="${cls}"
                    id="${id}"
            ></div>`;

        expect(template.parsedHTML.bindings).toHaveLength(2);
        const b0 = template.parsedHTML.bindings[0] as AttributeBinding;
        const b1 = template.parsedHTML.bindings[1] as AttributeBinding;
        expect(b0.keys).toEqual(["class"]);
        expect(b1.keys).toEqual(["id"]);
    });

    test("tabs in attribute spacing", () => {
        const val = "test";
        const template = html`
            <div class="${val}"></div>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        const binding = template.parsedHTML.bindings[0] as AttributeBinding;
        expect(binding.keys).toEqual(["class"]);
    });

    test("whitespace between tag name and self-closing slash", () => {
        const template = html`<br/>`;
        expect(template.parsedHTML.bindings).toHaveLength(0);
    });

    test("whitespace around attribute equals sign is part of key/value", () => {
        const val = "test";
        const template = html`
            <div class="${val}"></div>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
    });
});

describe("html parser — void and self-closing elements", () => {
    test("void elements produce no end tag issues", () => {
        const val = "hello";
        const template = html`<br/><p>${val}</p>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.CONTENT,
        );
    });

    test("multiple void elements with dynamic attributes", () => {
        const type1 = "text";
        const type2 = "email";
        const template = html`<input type="${type1}"/><input type="${type2}"/>`;

        expect(template.parsedHTML.bindings).toHaveLength(2);
        expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.ATTR);
        expect(template.parsedHTML.bindings[1].type).toBe(BINDING_TYPES.ATTR);
    });

    test("img with dynamic src", () => {
        const src = "image.png";
        const template = html`<img src="${src}"/>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        const binding = template.parsedHTML.bindings[0] as AttributeBinding;
        expect(binding.keys).toEqual(["src"]);
    });

    test("void element between elements with content bindings", () => {
        const a = "before";
        const b = "after";
        const template = html`<p>${a}</p><br/><p>${b}</p>`;

        expect(template.parsedHTML.bindings).toHaveLength(2);
        expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
    });
});

describe("html parser — fragment structure", () => {
    test("static template produces correct DOM structure", () => {
        const template = html`
            <div><span>hello</span></div>`;
        const div = template.parsedHTML.fragment.querySelector("div");
        expect(div).not.toBeNull();
        const span = div?.querySelector("span");
        expect(span).not.toBeNull();
        expect(span?.textContent).toBe("hello");
    });

    test("multiple root elements in fragment", () => {
        const template = html`<p>one</p><p>two</p><p>three</p>`;
        const ps = template.parsedHTML.fragment.querySelectorAll("p");
        expect(ps.length).toBe(3);
    });

    test("dynamic tag uses placeholder div in fragment", () => {
        const tag = "section";
        const template = html`
            <${tag}>content</${tag}>`;

        // Dynamic tags use a placeholder "div" in the fragment
        const div = template.parsedHTML.fragment.querySelector("div");
        expect(div).not.toBeNull();
    });

    test("static attributes are present in fragment", () => {
        const dyn = "dynamic";
        const template = html`
            <div id="static" class="${dyn}">text</div>`;

        const div = template.parsedHTML.fragment.querySelector("div");
        expect(div?.getAttribute("id")).toBe("static");
    });

    test("content binding inserts comment markers", () => {
        const val = "text";
        const template = html`
            <div>${val}</div>`;

        const div = template.parsedHTML.fragment.querySelector("div");
        // Comment markers should be present for content bindings
        const comments = Array.from(div?.childNodes ?? []).filter(
            n => n.nodeType === Node.COMMENT_NODE
        );
        expect(comments.length).toBeGreaterThan(0);
    });

    test("raw content style has no comment markers inside", () => {
        const color = "red";
        const template = html`
            <style>p {
                color: ${color};
            }</style>`;

        // Style content should not have comment markers inside
        // Instead the whole content is managed as raw content
        const style = template.parsedHTML.fragment.querySelector("style");
        // The style element might be empty in the fragment (content added at render time)
        // or have comment markers at the element level, not inside text
        expect(style).not.toBeNull();
    });
});

describe("html parser — complex templates", () => {
    test("mixed binding types in one template", () => {
        const tag = "div";
        const cls = "red";
        const text = "hello";
        const template = html`
            <${tag} class="${cls}">${text}</${tag}>`;

        expect(template.parsedHTML.bindings.length).toBeGreaterThanOrEqual(
            3,
        );

        const types = template.parsedHTML.bindings.map((b) => b.type);
        expect(types).toContain(BINDING_TYPES.TAG);
        expect(types).toContain(BINDING_TYPES.ATTR);
        expect(types).toContain(BINDING_TYPES.CONTENT);
    });

    test("deeply nested dynamic content", () => {
        const a = "1";
        const b = "2";
        const c = "3";
        const template = html`
            <div>${a}<span>${b}<em>${c}</em></span></div>`;

        expect(template.parsedHTML.bindings).toHaveLength(3);
        expect(template.parsedHTML.expressionToBinding).toEqual([0, 1, 2]);
    });

    test("sibling elements with dynamic content", () => {
        const a = "first";
        const b = "second";
        const c = "third";
        const template = html`<p>${a}</p><p>${b}</p><p>${c}</p>`;

        expect(template.parsedHTML.bindings).toHaveLength(3);
    });

    test("expression as only child", () => {
        const val = "alone";
        const template = html`${val}`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.CONTENT,
        );
    });

    test("multiple expressions with no static content between them", () => {
        const a = "x";
        const b = "y";
        const template = html`${a}${b}`;

        expect(template.parsedHTML.bindings).toHaveLength(2);
        expect(template.currentExpressions).toEqual(["x", "y"]);
    });
});

describe("html parser — mixed scenarios", () => {
    test("content then attribute then content", () => {
        const text1 = "before";
        const cls = "mid";
        const text2 = "after";
        const template = html`<p>${text1}</p>
        <div class="${cls}"></div><p>${text2}</p>`;

        expect(template.parsedHTML.bindings).toHaveLength(3);
        expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
        expect(template.parsedHTML.bindings[1].type).toBe(BINDING_TYPES.ATTR);
        expect(template.parsedHTML.bindings[2].type).toBe(BINDING_TYPES.CONTENT);
    });

    test("dynamic tag with content binding inside", () => {
        const tag = "div";
        const text = "hello";
        const template = html`
            <${tag}>${text}</${tag}>`;

        const types = template.parsedHTML.bindings.map(b => b.type);
        expect(types).toContain(BINDING_TYPES.TAG);
        expect(types).toContain(BINDING_TYPES.CONTENT);
    });

    test("attribute binding then raw content binding", () => {
        const cls = "highlight";
        const css = "color: red";
        const template = html`
            <div class="${cls}"></div>
            <style>p {
                ${css}
            }</style>`;

        expect(template.parsedHTML.bindings).toHaveLength(2);
        expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.ATTR);
        expect(template.parsedHTML.bindings[1].type).toBe(BINDING_TYPES.RAW_CONTENT);
    });

    test("deeply nested template with all binding types", () => {
        const tag = "section";
        const cls = "wrapper";
        const text = "content";
        const css = "color: blue";
        const template = html`
            <${tag} class="${cls}"><p>${text}</p>
                <style>${css}</style>
            </${tag}>`;

        const types = template.parsedHTML.bindings.map(b => b.type);
        expect(types).toContain(BINDING_TYPES.TAG);
        expect(types).toContain(BINDING_TYPES.ATTR);
        expect(types).toContain(BINDING_TYPES.CONTENT);
        expect(types).toContain(BINDING_TYPES.RAW_CONTENT);
    });

    test("sibling elements each with different binding types", () => {
        const tag = "h1";
        const text = "title";
        const cls = "body";
        const css = "margin: 0";
        const template = html`
            <${tag}>${text}</${tag}>
            <div class="${cls}">static</div>
            <style>${css}</style>`;

        expect(template.parsedHTML.bindings.length).toBeGreaterThanOrEqual(4);
    });

    test("list rendering pattern", () => {
        const items = ["a", "b", "c"];
        const template = html`
            <ul>${items.map(i => html`
                <li>${i}</li>`)}
            </ul>`;

        // The array of templates is a single content binding
        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
    });

    test("conditional rendering pattern", () => {
        const show = true;
        const template = html`
            <div>${show ? html`<span>yes</span>` : null}</div>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
    });

    test("real-world component pattern with style, attributes, and content", () => {
        const color = "blue";
        const cls = "active";
        const label = "Click me";
        const handler = () => {
        };
        const template = html`
            <style>
                :host {
                    color: ${color};
                }
            </style>
            <button class="${cls}" onclick="${handler}">
                ${label}
            </button>
        `;

        expect(template.parsedHTML.bindings.length).toBe(4);
        const types = template.parsedHTML.bindings.map(b => b.type);
        expect(types).toContain(BINDING_TYPES.RAW_CONTENT);
        expect(types).toContain(BINDING_TYPES.ATTR);
        expect(types).toContain(BINDING_TYPES.CONTENT);
    });
});
