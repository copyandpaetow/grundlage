import {html, render} from "../../../lib/src";
import {type ComponentConstructor} from "../../../lib/src/types";

let attrs = ["disabled", "hidden"];

const component = render(function* () {
    yield () => html`
        <button ${attrs}>click</button>
        <p>attributes are </p>
        <ul>
            ${attrs.map(item => html`
                <li>${item}</li>`)}
        </ul>
    `;
    yield () => {
        throw new Error("here")
    }
}) as ComponentConstructor

customElements.define(
    "attribute-component",
    component,
);


declare global {
    interface HTMLElementTagNameMap {
        'attribute-component': InstanceType<typeof component>;
    }
}