import {html, render} from "../../../lib/src";

customElements.define(
    "nav-bar",
    render(function* () {
        yield html`
            <nav>
                <a href="/grundlage">home</a>
                <a href="/grundlage/pages/async/">async</a>
                <a href="/grundlage/pages/animation/">animation</a>
                <a href="/grundlage/pages/attributes/">attributes</a>
                <a href="/grundlage/pages/list/">list</a>
                <a href="/grundlage/pages/tags/">heading</a>
                <a href="/grundlage/pages/perf/">perf</a>
            </nav>
        `;
    }),
);
