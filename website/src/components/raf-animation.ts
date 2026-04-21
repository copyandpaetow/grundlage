import { html, render } from "../../../lib/src";

customElements.define(
	"raf-animation",
	render(function* (element) {
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

		const bar = (phase: number) => {
			const currentPhase = time + phase;
			return {
				width: 50 + 45 * Math.sin(currentPhase),
				hue: (currentPhase * 53) % 360,
				lightness: 45 + 15 * Math.cos(currentPhase * 1.3),
				opacity: 0.4 + 0.6 * Math.abs(Math.sin(currentPhase * 0.7)),
				counter: Math.floor(currentPhase * 1000) % 10000,
			};
		};

		yield () => {
			const bar0 = bar(0.0);
			const bar1 = bar(0.3);
			const bar2 = bar(0.6);
			const bar3 = bar(0.9);
			const bar4 = bar(1.2);
			const bar5 = bar(1.5);
			const bar6 = bar(1.8);
			const bar7 = bar(2.1);
			const bar8 = bar(2.4);
			const bar9 = bar(2.7);
			const bar10 = bar(3.0);
			const bar11 = bar(3.3);
			const bar12 = bar(3.6);
			const bar13 = bar(3.9);
			const bar14 = bar(4.2);
			const bar15 = bar(4.5);
			const bar16 = bar(4.8);
			const bar17 = bar(5.1);
			const bar18 = bar(5.4);
			const bar19 = bar(5.7);

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
				<div class="row">
					<span>b00</span>
					<div
						class="bar"
						style="width:${bar0.width}%;background:hsl(${bar0.hue},70%,${bar0.lightness}%);opacity:${bar0.opacity}"
					></div>
					<span>${bar0.counter}</span>
				</div>
				<div class="row">
					<span>b01</span>
					<div
						class="bar"
						style="width:${bar1.width}%;background:hsl(${bar1.hue},70%,${bar1.lightness}%);opacity:${bar1.opacity}"
					></div>
					<span>${bar1.counter}</span>
				</div>
				<div class="row">
					<span>b02</span>
					<div
						class="bar"
						style="width:${bar2.width}%;background:hsl(${bar2.hue},70%,${bar2.lightness}%);opacity:${bar2.opacity}"
					></div>
					<span>${bar2.counter}</span>
				</div>
				<div class="row">
					<span>b03</span>
					<div
						class="bar"
						style="width:${bar3.width}%;background:hsl(${bar3.hue},70%,${bar3.lightness}%);opacity:${bar3.opacity}"
					></div>
					<span>${bar3.counter}</span>
				</div>
				<div class="row">
					<span>b04</span>
					<div
						class="bar"
						style="width:${bar4.width}%;background:hsl(${bar4.hue},70%,${bar4.lightness}%);opacity:${bar4.opacity}"
					></div>
					<span>${bar4.counter}</span>
				</div>
				<div class="row">
					<span>b05</span>
					<div
						class="bar"
						style="width:${bar5.width}%;background:hsl(${bar5.hue},70%,${bar5.lightness}%);opacity:${bar5.opacity}"
					></div>
					<span>${bar5.counter}</span>
				</div>
				<div class="row">
					<span>b06</span>
					<div
						class="bar"
						style="width:${bar6.width}%;background:hsl(${bar6.hue},70%,${bar6.lightness}%);opacity:${bar6.opacity}"
					></div>
					<span>${bar6.counter}</span>
				</div>
				<div class="row">
					<span>b07</span>
					<div
						class="bar"
						style="width:${bar7.width}%;background:hsl(${bar7.hue},70%,${bar7.lightness}%);opacity:${bar7.opacity}"
					></div>
					<span>${bar7.counter}</span>
				</div>
				<div class="row">
					<span>b08</span>
					<div
						class="bar"
						style="width:${bar8.width}%;background:hsl(${bar8.hue},70%,${bar8.lightness}%);opacity:${bar8.opacity}"
					></div>
					<span>${bar8.counter}</span>
				</div>
				<div class="row">
					<span>b09</span>
					<div
						class="bar"
						style="width:${bar9.width}%;background:hsl(${bar9.hue},70%,${bar9.lightness}%);opacity:${bar9.opacity}"
					></div>
					<span>${bar9.counter}</span>
				</div>
				<div class="row">
					<span>b10</span>
					<div
						class="bar"
						style="width:${bar10.width}%;background:hsl(${bar10.hue},70%,${bar10.lightness}%);opacity:${bar10.opacity}"
					></div>
					<span>${bar10.counter}</span>
				</div>
				<div class="row">
					<span>b11</span>
					<div
						class="bar"
						style="width:${bar11.width}%;background:hsl(${bar11.hue},70%,${bar11.lightness}%);opacity:${bar11.opacity}"
					></div>
					<span>${bar11.counter}</span>
				</div>
				<div class="row">
					<span>b12</span>
					<div
						class="bar"
						style="width:${bar12.width}%;background:hsl(${bar12.hue},70%,${bar12.lightness}%);opacity:${bar12.opacity}"
					></div>
					<span>${bar12.counter}</span>
				</div>
				<div class="row">
					<span>b13</span>
					<div
						class="bar"
						style="width:${bar13.width}%;background:hsl(${bar13.hue},70%,${bar13.lightness}%);opacity:${bar13.opacity}"
					></div>
					<span>${bar13.counter}</span>
				</div>
				<div class="row">
					<span>b14</span>
					<div
						class="bar"
						style="width:${bar14.width}%;background:hsl(${bar14.hue},70%,${bar14.lightness}%);opacity:${bar14.opacity}"
					></div>
					<span>${bar14.counter}</span>
				</div>
				<div class="row">
					<span>b15</span>
					<div
						class="bar"
						style="width:${bar15.width}%;background:hsl(${bar15.hue},70%,${bar15.lightness}%);opacity:${bar15.opacity}"
					></div>
					<span>${bar15.counter}</span>
				</div>
				<div class="row">
					<span>b16</span>
					<div
						class="bar"
						style="width:${bar16.width}%;background:hsl(${bar16.hue},70%,${bar16.lightness}%);opacity:${bar16.opacity}"
					></div>
					<span>${bar16.counter}</span>
				</div>
				<div class="row">
					<span>b17</span>
					<div
						class="bar"
						style="width:${bar17.width}%;background:hsl(${bar17.hue},70%,${bar17.lightness}%);opacity:${bar17.opacity}"
					></div>
					<span>${bar17.counter}</span>
				</div>
				<div class="row">
					<span>b18</span>
					<div
						class="bar"
						style="width:${bar18.width}%;background:hsl(${bar18.hue},70%,${bar18.lightness}%);opacity:${bar18.opacity}"
					></div>
					<span>${bar18.counter}</span>
				</div>
				<div class="row">
					<span>b19</span>
					<div
						class="bar"
						style="width:${bar19.width}%;background:hsl(${bar19.hue},70%,${bar19.lightness}%);opacity:${bar19.opacity}"
					></div>
					<span>${bar19.counter}</span>
				</div>
			`;
		};
	}),
);
