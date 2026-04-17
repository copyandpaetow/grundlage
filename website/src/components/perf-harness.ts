import {html, render} from "../../../lib/src";

/*
    Runs a fixed number of update() calls driven by requestAnimationFrame
    and reports wall time, frames-per-second, and (when available) heap delta.

    Usage: <perf-harness frames="3000"></perf-harness>

    For heap numbers start Chrome with --enable-precise-memory-info to get
    byte-accurate performance.memory readings; otherwise the browser rounds
    aggressively and small changes are invisible.
*/

type RunState = "idle" | "running" | "done";

type Result = {
    frames: number;
    durationMs: number;
    framesPerSecond: number;
    averageFrameMs: number;
    heapStartMb: number | null;
    heapEndMb: number | null;
    heapDeltaMb: number | null;
};

const readHeapMb = (): number | null => {
    const memory = (performance as unknown as {memory?: {usedJSHeapSize: number}}).memory;
    if (!memory) return null;
    return memory.usedJSHeapSize / 1_000_000;
};

const formatNumber = (value: number, digits = 2) => value.toFixed(digits);

customElements.define(
    "perf-harness",
    render(function* (element) {
        const totalFrames = Number(element.getAttribute("frames") ?? 3000);

        let state: RunState = "idle";
        let framesElapsed = 0;
        let startTime = 0;
        let heapStart: number | null = null;
        let result: Result | null = null;

        const busyValues = Array.from({length: 20}, (_, index) => index * 0.123);

        const tick = () => {
            framesElapsed++;

            for (let index = 0; index < busyValues.length; index++) {
                const phase = framesElapsed / 60 + index * 0.3;
                busyValues[index] = 50 + 45 * Math.sin(phase);
            }

            element.update();

            if (framesElapsed < totalFrames) {
                requestAnimationFrame(tick);
                return;
            }

            const endTime = performance.now();
            const heapEnd = readHeapMb();
            const durationMs = endTime - startTime;
            result = {
                frames: framesElapsed,
                durationMs,
                framesPerSecond: (framesElapsed / durationMs) * 1000,
                averageFrameMs: durationMs / framesElapsed,
                heapStartMb: heapStart,
                heapEndMb: heapEnd,
                heapDeltaMb:
                    heapStart !== null && heapEnd !== null
                        ? heapEnd - heapStart
                        : null,
            };
            state = "done";
            element.update();
        };

        const startRun = () => {
            if (state === "running") return;
            state = "running";
            framesElapsed = 0;
            result = null;
            heapStart = readHeapMb();
            startTime = performance.now();
            requestAnimationFrame(tick);
            element.update();
        };

        yield () => html`
            <style>
                :host {
                    display: block;
                    font: 13px monospace;
                }

                button {
                    padding: 8px 16px;
                    font: inherit;
                    cursor: pointer;
                }

                button[disabled] {
                    cursor: not-allowed;
                    opacity: 0.6;
                }

                .grid {
                    display: grid;
                    grid-template-columns: max-content 1fr;
                    gap: 4px 16px;
                    margin-top: 12px;
                }

                .bars {
                    display: grid;
                    gap: 2px;
                    margin-top: 12px;
                }

                .bar {
                    height: 6px;
                    background: steelblue;
                }

                .status {
                    margin-top: 8px;
                }
            </style>

            <button onClick="${startRun}">
                ${state === "running" ? "running…" : `run ${totalFrames} frames`}
            </button>

            <div class="status">
                state: ${state} · frame ${framesElapsed} / ${totalFrames}
            </div>

            <div class="bars">
                <div class="bar" style="width:${busyValues[0]}%"></div>
                <div class="bar" style="width:${busyValues[1]}%"></div>
                <div class="bar" style="width:${busyValues[2]}%"></div>
                <div class="bar" style="width:${busyValues[3]}%"></div>
                <div class="bar" style="width:${busyValues[4]}%"></div>
                <div class="bar" style="width:${busyValues[5]}%"></div>
                <div class="bar" style="width:${busyValues[6]}%"></div>
                <div class="bar" style="width:${busyValues[7]}%"></div>
                <div class="bar" style="width:${busyValues[8]}%"></div>
                <div class="bar" style="width:${busyValues[9]}%"></div>
                <div class="bar" style="width:${busyValues[10]}%"></div>
                <div class="bar" style="width:${busyValues[11]}%"></div>
                <div class="bar" style="width:${busyValues[12]}%"></div>
                <div class="bar" style="width:${busyValues[13]}%"></div>
                <div class="bar" style="width:${busyValues[14]}%"></div>
                <div class="bar" style="width:${busyValues[15]}%"></div>
                <div class="bar" style="width:${busyValues[16]}%"></div>
                <div class="bar" style="width:${busyValues[17]}%"></div>
                <div class="bar" style="width:${busyValues[18]}%"></div>
                <div class="bar" style="width:${busyValues[19]}%"></div>
            </div>

            ${result
                ? html`
                    <div class="grid">
                        <span>frames</span><span>${result.frames}</span>
                        <span>duration</span><span>${formatNumber(result.durationMs)} ms</span>
                        <span>fps</span><span>${formatNumber(result.framesPerSecond)}</span>
                        <span>avg frame</span><span>${formatNumber(result.averageFrameMs, 3)} ms</span>
                        <span>heap start</span><span>${result.heapStartMb !== null ? `${formatNumber(result.heapStartMb)} MB` : "n/a"}</span>
                        <span>heap end</span><span>${result.heapEndMb !== null ? `${formatNumber(result.heapEndMb)} MB` : "n/a"}</span>
                        <span>heap delta</span><span>${result.heapDeltaMb !== null ? `${formatNumber(result.heapDeltaMb)} MB` : "n/a"}</span>
                    </div>
                `
                : html``}
        `;
    }),
);
