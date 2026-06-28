const parserHost = document.createElement("template");

export const buildFragment = (result: string): DocumentFragment => {
	parserHost.innerHTML = result;
	const fragment = document.createDocumentFragment();
	while (parserHost.content.firstChild) {
		fragment.append(parserHost.content.firstChild);
	}
	return fragment;
};
