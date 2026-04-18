import {html, render} from "../../../lib/src";

/*
    Same visual shape as <raf-animation> but the bars are produced by
    mapping over an array instead of being hardcoded. Every frame every
    bar changes, so each frame the list reconciliation walks 20 items
    whose hashes all differ from the previous frame. Useful for comparing
    list-diff performance against the hardcoded baseline.
*/

customElements.define(
    "raf-animation-list",
    render(function* (element) {
        const barCount = 20;
        const phases = Array.from({length: barCount}, (_, index) => index * 0.3);

        let time = 0;
        let remainingFrames = 30_000;

        const updateFrame = () => {
            remainingFrames--;
            time += 1 / 60;
            element.update();
            if (remainingFrames > 0) {
                requestAnimationFrame(updateFrame);
            }
        };
        requestAnimationFrame(updateFrame);

        const computeBar = (phase: number, barIndex: number) => {
            const currentPhase = time + phase;
            return {
                index: barIndex,
                width: 50 + 45 * Math.sin(currentPhase),
                hue: (currentPhase * 53) % 360,
                lightness: 45 + 15 * Math.cos(currentPhase * 1.3),
                opacity: 0.4 + 0.6 * Math.abs(Math.sin(currentPhase * 0.7)),
                counter: Math.floor(currentPhase * 1000) % 10000,
            };
        };

        const formatLabel = (index: number) =>
            `b${index.toString().padStart(2, "0")}`;

        yield () => {
            const bars = phases.map((phase, index) => computeBar(phase, index));

            return html`
                <style>
                    :host {
                        display: block;
                        font: 12px monospace;
                    }

                    .bar {
                        height: 8px;
                        margin: 1px 0;
                    }

                    .row {
                        display: grid;
                        grid-template-columns: 40px 1fr 64px;
                        gap: 4px;
                        align-items: center;
                    }
                </style>
                <h1>frames left: ${remainingFrames} · t=${time}</h1>
                ${bars.map(
                    (bar) => html`
                        <div class="row">
                            <span>${formatLabel(bar.index)}</span>
                            <div
                                class="bar"
                                style="width:${bar.width}%;background:hsl(${bar.hue},70%,${bar.lightness}%);opacity:${bar.opacity}"
                            ></div>
                            <span>${bar.counter}</span>
                        </div>
                    `,
                )}
            `;
        };
    }),
);
