import { COMMENT_IDENTIFIER } from "../parser/html-util";
import { BINDING_TYPES, ParsedHTML } from "../parser/types";
import { hashValue } from "../utils/hashing";
import { updateAttribute } from "./attribute";
import { updateContent } from "./content";
import { updateRawContent } from "./raw-content";
import { updateTag } from "./tag";

const EMPTY_ARRAY: Array<unknown> = [] as const;

const updateByType = {
	[BINDING_TYPES.TAG]: updateTag,
	[BINDING_TYPES.ATTR]: updateAttribute,
	[BINDING_TYPES.CONTENT]: updateContent,
	[BINDING_TYPES.RAW_CONTENT]: updateRawContent,
} as const;

export class HTMLTemplate {
	#hash: number | undefined;
	parsedHTML: ParsedHTML;
	//markers[i] and dirtyBindings[i] line up with parsedHTML.bindings[i] — same index across all three arrays addresses the same binding
	markers: Array<Comment>;
	dirtyBindings: Uint8Array;
	//currentExpressions[i] is the i-th interpolation in the template literal (the i-th `${...}`)
	currentExpressions: Array<unknown>;
	previousExpressions = EMPTY_ARRAY;

	//we cache this per-update and invalidate in update() when expressions change
	get hash(): number {
		if (this.#hash === undefined) {
			const expressions = this.currentExpressions;
			let hash = expressions.length;
			for (let index = 0; index < expressions.length; index++) {
				hash = (Math.imul(hash, 31) + hashValue(expressions[index])) | 0;
			}
			//we XOR-mix shape and content so that `tplA(1, 2)` and `tplB(1, 2)` don't collide
			//a plain add would let a different template with the same expression-fold land on the same hash
			this.#hash = this.parsedHTML.templateHash ^ Math.imul(hash, 31);
		}
		return this.#hash;
	}

	constructor(parsedHTML: ParsedHTML, expressions: Array<unknown>) {
		this.parsedHTML = parsedHTML;
		this.currentExpressions = expressions;
	}

	setup(): DocumentFragment {
		const bindingCount = this.parsedHTML.bindings.length;
		this.dirtyBindings = new Uint8Array(bindingCount).fill(1);
		const fragment = this.parsedHTML.fragment.cloneNode(
			true,
		) as DocumentFragment;

		this.markers = this.#findMarkers(fragment);
		this.#flush();

		return fragment;
	}

	hydrate(context: ShadowRoot) {
		//Uint8Array is zero-initialized by the spec, so we don't need to fill explicitly
		this.dirtyBindings = new Uint8Array(this.parsedHTML.bindings.length);
		this.markers = this.#findMarkers(context);

		for (let index = 0; index < this.parsedHTML.bindings.length; index++) {
			const binding = this.parsedHTML.bindings[index];
			if (binding.type === BINDING_TYPES.ATTR) {
				updateByType[binding.type](this, index);
			}
		}
	}

	#findMarkers(parent: DocumentFragment | ShadowRoot) {
		const markers = [];
		const treeWalker = document.createTreeWalker(
			parent,
			NodeFilter.SHOW_COMMENT,
		);

		let lastMarkerData = "";
		while (treeWalker.nextNode()) {
			const marker = treeWalker.currentNode as Comment;

			if (!marker.data.startsWith(COMMENT_IDENTIFIER)) {
				continue;
			}

			//content bindings emit two markers carrying identical data (one before and one after the binding's content) so the renderer can find the binding's range
			//=> when we collect markers we only want the first of each pair, so we skip any marker whose data matches the previous one
			if (lastMarkerData === marker.data) {
				continue;
			}
			lastMarkerData = marker.data;
			markers.push(marker);
		}

		return markers;
	}

	update(expressions: Array<unknown>) {
		const previousExpressions = this.currentExpressions;
		this.previousExpressions = previousExpressions;
		this.currentExpressions = expressions;
		this.#hash = undefined;

		for (let index = 0; index < expressions.length; index++) {
			const currentEntry = expressions[index];
			const previousEntry = previousExpressions[index];

			if (currentEntry === previousEntry) continue;

			//the `===` check above already settled every primitive (a primitive that didn't match by identity also doesn't match by value)
			//=> the only entries that can still be "equal in content but not in identity" are objects and functions, so only those need the hash-based comparison below
			const currentType = typeof currentEntry;
			const needsContentCompare =
				(currentType === "object" && currentEntry !== null) ||
				currentType === "function";

			//arrays are reconciled per-item inside renderList via hash-based identity matching
			//if we hashed the whole list here we would walk every item only for renderList to walk them again
			//=> we just mark dirty and let the one place that needs the per-item compare do it
			if (Array.isArray(currentEntry)) {
				this.dirtyBindings[this.parsedHTML.expressionToBinding[index]] = 1;
				continue;
			}

			if (
				needsContentCompare &&
				hashValue(currentEntry) === hashValue(previousEntry)
			) {
				if (currentEntry instanceof HTMLTemplate) {
					expressions[index] = previousEntry;
				}
				continue;
			}

			this.dirtyBindings[this.parsedHTML.expressionToBinding[index]] = 1;
		}
		this.#flush();
		//previousExpressions is only read during #flush
		//=> we drop the reference so the prior frame's values (possibly large objects) can be collected between renders in long-lived idle components
		this.previousExpressions = EMPTY_ARRAY;
	}

	#flush() {
		const dirtyBindings = this.dirtyBindings;
		for (
			let bindingIndex = 0;
			bindingIndex < dirtyBindings.length;
			bindingIndex++
		) {
			if (!dirtyBindings[bindingIndex]) continue;
			dirtyBindings[bindingIndex] = 0;
			updateByType[this.parsedHTML.bindings[bindingIndex].type](
				this,
				bindingIndex,
			);
		}
	}
}
