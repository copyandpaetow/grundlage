//materializes the parser's document-free `result` string into a DocumentFragment (ADR-0010).
//the parser stays DOM-free; this is the one seam that touches the DOM, run lazily on first setup() and cached on the shared ParsedHTML.

//a <template> element parses its innerHTML under the "in template" insertion mode, which correctly handles table-related tags (<tr>, <td>, <tbody>, …)
//=> using a default Range here would anchor parsing to <body>, where those tags are a parse error and get silently dropped
const parserHost = document.createElement("template");

export const buildFragment = (result: string): DocumentFragment => {
	parserHost.innerHTML = result;
	//the cached ParsedHTML must own its own fragment because the next buildFragment overwrites parserHost.content
	//=> we move the parsed children into a fresh fragment one at a time (append takes ownership), which is cheaper than cloning and avoids allocating a snapshot array
	const fragment = document.createDocumentFragment();
	while (parserHost.content.firstChild) {
		fragment.append(parserHost.content.firstChild);
	}
	return fragment;
};
