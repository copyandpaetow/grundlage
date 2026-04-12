import {describe, test, expect} from "vitest";
import {html} from "./html";
import {BINDING_TYPES, AttributeBinding, TagBinding} from "./types";

describe("html parser", () => {
    describe("static templates", () => {
        test("produces no bindings", () => {
            const template = html`<div>hello</div>`;
            expect(template.parsedHTML.bindings).toHaveLength(0);
            expect(template.parsedHTML.expressionToBinding).toHaveLength(0);
        });

        test("preserves static attributes", () => {
            const template = html`<div class="red" id="main">text</div>`;
            expect(template.parsedHTML.bindings).toHaveLength(0);
            const div = template.parsedHTML.fragment.querySelector("div")!;
            expect(div.getAttribute("class")).toBe("red");
            expect(div.getAttribute("id")).toBe("main");
        });

        test("handles self-closing tags", () => {
            const template = html`<div><br/><hr/></div>`;
            expect(template.parsedHTML.bindings).toHaveLength(0);
        });

        test("handles nested elements", () => {
            const template = html`<div><span><a>deep</a></span></div>`;
            expect(template.parsedHTML.bindings).toHaveLength(0);
        });
    });

    describe("content bindings", () => {
        test("text expression creates a content binding", () => {
            const name = "world";
            const template = html`<div>${name}</div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            expect(template.parsedHTML.bindings[0].type).toBe(
                BINDING_TYPES.CONTENT,
            );
            expect(template.currentExpressions).toEqual(["world"]);
        });

        test("multiple text expressions create separate bindings", () => {
            const a = "hello";
            const b = "world";
            const template = html`<p>${a}</p><p>${b}</p>`;

            expect(template.parsedHTML.bindings).toHaveLength(2);
            expect(template.parsedHTML.bindings[0].type).toBe(
                BINDING_TYPES.CONTENT,
            );
            expect(template.parsedHTML.bindings[1].type).toBe(
                BINDING_TYPES.CONTENT,
            );
            expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
        });

        test("adjacent text expressions share no binding", () => {
            const a = "hello";
            const b = "world";
            const template = html`<div>${a}${b}</div>`;

            expect(template.parsedHTML.bindings).toHaveLength(2);
            expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
        });

        test("expression between static text", () => {
            const name = "world";
            const template = html`<div>hello ${name} goodbye</div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            expect(template.parsedHTML.bindings[0].type).toBe(
                BINDING_TYPES.CONTENT,
            );
        });

        test("nested template expression", () => {
            const inner = html`<span>child</span>`;
            const template = html`<div>${inner}</div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            expect(template.parsedHTML.bindings[0].type).toBe(
                BINDING_TYPES.CONTENT,
            );
        });

        test("array expression", () => {
            const items = [1, 2, 3];
            const template = html`<ul>${items}</ul>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            expect(template.parsedHTML.bindings[0].type).toBe(
                BINDING_TYPES.CONTENT,
            );
        });
    });

    describe("attribute bindings", () => {
        test("single dynamic value", () => {
            const cls = "active";
            const template = html`<div class="${cls}"></div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.type).toBe(BINDING_TYPES.ATTR);
            expect(binding.keys).toEqual(["class"]);
            expect(binding.values).toContainEqual(expect.any(Number));
        });

        test("multi-part attribute value shares one binding", () => {
            const a = "hello";
            const b = "world";
            const template = html`<div class="${a} ${b}"></div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.type).toBe(BINDING_TYPES.ATTR);
            // both expressions map to the same binding
            expect(template.parsedHTML.expressionToBinding).toEqual([0, 0]);
        });

        test("dynamic attribute name (boolean)", () => {
            const name = "disabled";
            const template = html`<button ${name}></button>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.type).toBe(BINDING_TYPES.ATTR);
            // keys should contain only the expression index, no empty strings
            expect(binding.keys).toEqual([0]);
            expect(binding.values).toHaveLength(0);
        });

        test("dynamic attribute name with static prefix", () => {
            const suffix = "name";
            const template = html`<div data-${suffix}="value"></div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.type).toBe(BINDING_TYPES.ATTR);
            expect(binding.keys[0]).toBe("data-");
        });

        test("multiple attributes on one element create separate bindings", () => {
            const cls = "red";
            const id = "main";
            const template = html`<div class="${cls}" id="${id}"></div>`;

            expect(template.parsedHTML.bindings).toHaveLength(2);
            expect(template.parsedHTML.bindings[0].type).toBe(
                BINDING_TYPES.ATTR,
            );
            expect(template.parsedHTML.bindings[1].type).toBe(
                BINDING_TYPES.ATTR,
            );
            expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
        });

        test("event handler attribute", () => {
            const handler = () => {};
            const template = html`<button onclick="${handler}"></button>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.type).toBe(BINDING_TYPES.ATTR);
            expect(binding.keys).toEqual(["onclick"]);
        });

        test("unquoted attribute value", () => {
            const val = "test";
            const template = html`<div class=${val}></div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.type).toBe(BINDING_TYPES.ATTR);
        });

        test("boolean attribute followed by regular attribute", () => {
            const flag = "hidden";
            const cls = "red";
            const template = html`<div ${flag} class="${cls}"></div>`;

            expect(template.parsedHTML.bindings).toHaveLength(2);
            const boolBinding = template.parsedHTML
                .bindings[0] as AttributeBinding;
            const attrBinding = template.parsedHTML
                .bindings[1] as AttributeBinding;
            expect(boolBinding.values).toHaveLength(0);
            expect(attrBinding.keys).toEqual(["class"]);
        });
    });

    describe("expandable attributes", () => {
        test("array expandable has keys=[expressionIndex] and empty values", () => {
            const attrs = ["disabled", "hidden"];
            const template = html`<button ${attrs}>click</button>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.type).toBe(BINDING_TYPES.ATTR);
            expect(binding.keys).toEqual([0]);
            expect(binding.values).toHaveLength(0);
        });

        test("object expandable has keys=[expressionIndex] and empty values", () => {
            const attrs = {class: "red", id: "main"};
            const template = html`<div ${attrs}>content</div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.type).toBe(BINDING_TYPES.ATTR);
            expect(binding.keys).toEqual([0]);
            expect(binding.values).toHaveLength(0);
        });

        test("expandable after static attribute", () => {
            const extra = {title: "hello"};
            const template = html`<div class="base" ${extra}></div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.keys).toEqual([0]);
            expect(binding.values).toHaveLength(0);
        });

        test("expandable before static attribute", () => {
            const extra = {title: "hello"};
            const template = html`<div ${extra} class="base"></div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.keys).toEqual([0]);
            expect(binding.values).toHaveLength(0);
        });

        test("expandable between static attributes", () => {
            const extra = ["hidden"];
            const template = html`<div id="a" ${extra} class="b"></div>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as AttributeBinding;
            expect(binding.keys).toEqual([0]);
            expect(binding.values).toHaveLength(0);
        });
    });

    describe("tag bindings", () => {
        test("dynamic tag name", () => {
            const tag = "div";
            const template = html`<${tag}>content</${tag}>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            const binding = template.parsedHTML.bindings[0] as TagBinding;
            expect(binding.type).toBe(BINDING_TYPES.TAG);
        });

        test("dynamic tag with attributes tracks related bindings", () => {
            const tag = "div";
            const cls = "red";
            const template = html`<${tag} class="${cls}">content</${tag}>`;

            const tagBinding = template.parsedHTML.bindings[0] as TagBinding;
            expect(tagBinding.type).toBe(BINDING_TYPES.TAG);
            expect(tagBinding.relatedAttributes.length).toBeGreaterThan(0);
        });
    });

    describe("raw content bindings", () => {
        test("dynamic style content", () => {
            const color = "red";
            const template = html`<style>div { color: ${color}; }</style>`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            expect(template.parsedHTML.bindings[0].type).toBe(
                BINDING_TYPES.RAW_CONTENT,
            );
        });
    });

    describe("comment bindings", () => {
        test("expression inside HTML comment", () => {
            const msg = "debug info";
            const template = html`<!-- ${msg} -->`;

            expect(template.parsedHTML.bindings).toHaveLength(1);
            expect(template.parsedHTML.bindings[0].type).toBe(
                BINDING_TYPES.CONTENT,
            );
        });
    });

    describe("expression to binding mapping", () => {
        test("single expression maps to single binding", () => {
            const template = html`<div>${"text"}</div>`;
            expect(template.parsedHTML.expressionToBinding).toEqual([0]);
        });

        test("two expressions in one attribute share a binding", () => {
            const template = html`<div class="${"a"} ${"b"}"></div>`;
            expect(template.parsedHTML.expressionToBinding).toEqual([0, 0]);
        });

        test("expressions in different attributes map to different bindings", () => {
            const template = html`<div class="${"a"}" id="${"b"}"></div>`;
            expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
        });

        test("mixed content and attribute expressions", () => {
            const template = html`<div class="${"a"}">${"text"}</div>`;
            expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
        });
    });

    describe("template caching", () => {
        test("same template strings reuse cached parse result", () => {
            const a = html`<span>${"one"}</span>`;
            const b = html`<span>${"two"}</span>`;

            expect(a.parsedHTML).toStrictEqual(b.parsedHTML);
            expect(a.currentExpressions).toEqual(["one"]);
            expect(b.currentExpressions).toEqual(["two"]);
        });

        test("different template strings produce different parse results", () => {
            const a = html`<div>${"val"}</div>`;
            const b = html`<span>${"val"}</span>`;

            expect(a.parsedHTML.templateHash).not.toBe(
                b.parsedHTML.templateHash,
            );
        });
    });

    describe("complex templates", () => {
        test("mixed binding types in one template", () => {
            const tag = "div";
            const cls = "red";
            const text = "hello";
            const template = html`<${tag} class="${cls}">${text}</${tag}>`;

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
            const template = html`<div>${a}<span>${b}<em>${c}</em></span></div>`;

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
});
