import {describe, test, expect} from "vitest";
import {html} from "./html";
import {BINDING_TYPES, RawContentBinding} from "./types";

describe("html parser — raw content bindings", () => {
    test("dynamic style content", () => {
        const color = "red";
        const template = html`
            <style>div {
                color: ${color};
            }</style>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.RAW_CONTENT,
        );
    });

    test("dynamic content inside textarea", () => {
        const val = "user input";
        const template = html`<textarea>${val}</textarea>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.RAW_CONTENT,
        );
    });

    test("dynamic content inside script", () => {
        const code = "console.log('hi')";
        const template = html`
            <script>${code}</script>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.RAW_CONTENT,
        );
    });

    test("dynamic content inside template element", () => {
        const content = "<p>slot</p>";
        const template = html`
            <template>${content}</template>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.RAW_CONTENT,
        );
    });

    test("multiple expressions in style element share one binding", () => {
        const color = "red";
        const size = "16px";
        const template = html`
            <style>p {
                color: ${color};
                font-size: ${size};
            }</style>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        const binding = template.parsedHTML.bindings[0] as RawContentBinding;
        expect(binding.type).toBe(BINDING_TYPES.RAW_CONTENT);
        // Both expressions map to the same binding
        expect(template.parsedHTML.expressionToBinding).toEqual([0, 0]);
    });

    test("static raw content produces no bindings", () => {
        const template = html`
            <style>p {
                color: red;
            }</style>`;

        expect(template.parsedHTML.bindings).toHaveLength(0);
    });

    test("raw content element followed by regular element with binding", () => {
        const color = "red";
        const text = "hello";
        const template = html`
            <style>p {
                color: ${color};
            }</style><p>${text}</p>`;

        expect(template.parsedHTML.bindings).toHaveLength(2);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.RAW_CONTENT,
        );
        expect(template.parsedHTML.bindings[1].type).toBe(
            BINDING_TYPES.CONTENT,
        );
    });

    test("raw content preserves inner HTML-like text without parsing", () => {
        const injection = "<div>not a real tag</div>";
        const template = html`
            <style>${injection}</style>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.RAW_CONTENT,
        );
        // Should not create extra bindings from the HTML-like content
    });

    test("style element with attributes and dynamic content", () => {
        const css = "color: red";
        const template = html`
            <style type="text/css">p {
                ${css}
            }</style>`;

        expect(template.parsedHTML.bindings).toHaveLength(1);
        expect(template.parsedHTML.bindings[0].type).toBe(
            BINDING_TYPES.RAW_CONTENT,
        );
    });
});
