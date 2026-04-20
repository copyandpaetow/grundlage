import {describe, test, expect} from "vitest";
import {html} from "./html";
import {BINDING_TYPES, ContentBinding} from "./types";

describe("html parser — comment bindings", () => {
    test("expression inside HTML comment", () => {
        const msg = "debug info";
        const template = html`<!-- ${msg} -->`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.CONTENT,
        );
    });

    test("comment with no expressions is not a binding", () => {
        const template = html`<!-- static comment -->`;

        expect(template.parsedHTML.bindings).toHaveLength(0);
    });

    test("comment between elements with bindings", () => {
        const a = "first";
        const b = "second";
        const template = html`<p>${a}</p><!-- separator --><p>${b}</p>`;

        expect(template.parsedHTML.bindings).toHaveLength(2);
        expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
        expect(template.parsedHTML.bindings[1].type).toBe(BINDING_TYPES.CONTENT);
    });

    test("multiple expressions in one comment share one binding", () => {
        const a = "x";
        const b = "y";
        const template = html`<!-- ${a} and ${b} -->`;

        // Both expressions in the same comment share one content binding
        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.expressionToBinding).toEqual([0, 0]);
    });

    test("comment binding values do not include delimiters", () => {
        const msg = "debug";
        const template = html`<!-- ${msg} -->`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        const binding = template.parsedHTML.bindings[0] as ContentBinding;
        // Values should contain only the expression index and surrounding whitespace,
        // not the "<!--" or "-->" delimiters
        for (const value of binding.values) {
            if (typeof value === "string") {
                expect(value).not.toContain("<!--");
                expect(value).not.toContain("-->");
            }
        }
    });

    test("multi-expression comment binding values do not include delimiters", () => {
        const a = "x";
        const b = "y";
        const template = html`<!-- ${a} and ${b} -->`;

        const binding = template.parsedHTML.bindings[0] as ContentBinding;
        for (const value of binding.values) {
            if (typeof value === "string") {
                expect(value).not.toContain("<!--");
                expect(value).not.toContain("-->");
            }
        }
    });

    test("static comment is preserved in fragment", () => {
        const template = html`<div>text</div><!-- static -->`;

        // Static comments should be present in the fragment output
        const walker = document.createTreeWalker(
            template.parsedHTML.fragment,
            NodeFilter.SHOW_COMMENT,
        );
        const comments: Comment[] = [];
        let node;
        while ((node = walker.nextNode())) {
            comments.push(node as Comment);
        }
        const staticComment = comments.find(c => c.data.includes("static"));
        expect(staticComment).not.toBeUndefined();
    });

    test("static comment containing HTML-like text does not affect parsing", () => {
        //inside COMMENT state '<' and '>' are plain characters — only '-->' exits
        const template = html`<div>before</div><!-- <fake-tag class="x"> --><p>after</p>`;
        expect(template.parsedHTML.bindings).toHaveLength(0);
        expect(template.parsedHTML.fragment.querySelector("div")).not.toBeNull();
        expect(template.parsedHTML.fragment.querySelector("p")).not.toBeNull();
        expect(template.parsedHTML.fragment.querySelector("fake-tag")).toBeNull();
    });

    test("comment with no whitespace around the expression", () => {
        const msg = "x";
        const template = html`<!--${msg}-->`;
        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
    });
});
