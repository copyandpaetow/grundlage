export const moveArrayContents = (from: Array<unknown>, to: Array<unknown>) => {
	for (let index = 0; index < from.length; index++) {
		to.push(from[index]);
	}
	from.length = 0;
};
