import {html, props, render} from "../../../lib/src";

customElements.define(
    "tag-component",
    render(function* (element) {
        let {headingLevel} = props(element, {headingLevel: Number})

        const updateHeadingLevel = () => {
            headingLevel++;
            element.update();
        };

        yield () =>
            html`
                <h${headingLevel} onclick=${updateHeadingLevel}> headingLevel: ${headingLevel}</h${headingLevel}>
            `;
    }),
);
