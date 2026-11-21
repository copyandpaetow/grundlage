//Writes twice a second and allocates nothing per frame, so it does not skew what it shows

const SAMPLE_FRAME_COUNT = 60;
const FRAMES_PER_READOUT = 30;

export const mountFrameMeter = (): void => {
	const meter = document.createElement("output");
	meter.style.cssText =
		"position: fixed; right: 12px; bottom: 12px; z-index: 10; padding: 6px 10px; border-radius: 8px; background: rgba(0, 0, 0, 0.7); color: #fff; font: 600 13px/1 ui-monospace, monospace;";
	document.body.appendChild(meter);
	const intervals = new Float64Array(SAMPLE_FRAME_COUNT);
	const sortedIntervals = new Float64Array(SAMPLE_FRAME_COUNT);
	let frameIndex = 0;
	let previousTimestamp = 0;
	requestAnimationFrame(function measureFrame(timestamp) {
		if (previousTimestamp !== 0) {
			intervals[frameIndex % SAMPLE_FRAME_COUNT] = timestamp - previousTimestamp;
		}
		previousTimestamp = timestamp;
		frameIndex++;
		if (frameIndex > SAMPLE_FRAME_COUNT && frameIndex % FRAMES_PER_READOUT === 0) {
			sortedIntervals.set(intervals);
			sortedIntervals.sort();
			const medianFrameMilliseconds = sortedIntervals[SAMPLE_FRAME_COUNT / 2];
			meter.textContent = `${medianFrameMilliseconds.toFixed(1)} ms · ${Math.round(1000 / medianFrameMilliseconds)} fps`;
		}
		requestAnimationFrame(measureFrame);
	});
};
