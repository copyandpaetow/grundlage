export const moveArrayContents = (from: Array<unknown>, to: Array<unknown>) => {
	for (let arrIndex = 0; arrIndex < from.length; arrIndex++) {
		to.push(from[arrIndex]);
	}
	from.length = 0;
};
