
import { Window } from "happy-dom";

const globals = new Window();

global.document = globals.document;
global.customElements = globals.customElements;
global.HTMLElement = globals.HTMLElement;
global.HTMLTemplateElement = globals.HTMLTemplateElement;
global.Comment = globals.Comment;
global.DocumentFragment = globals.DocumentFragment
global.Element = globals.Element;
global.Range = globals.Range
global.requestAnimationFrame = globals.requestAnimationFrame
global.cancelAnimationFrame = globals.cancelAnimationFrame
global.MutationObserver = globals.MutationObserver
global.CSSStyleSheet = globals.CSSStyleSheet

export async function render(html, imports = []) {

    try {
        await Promise.all(imports.map((init) => init()));

        document.documentElement.innerHTML = html;
        return document.body.getHTML({ serializableShadowRoots: true });
    } catch (error) {
        console.warn("error", error)
        return ""
    }

   
}