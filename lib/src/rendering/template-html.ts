import {COMMENT_IDENTIFIER} from "../parser/html-util";
import {BINDING_TYPES, ParsedHTML} from "../parser/types";
import {hashValue} from "../utils/hashing";
import {updateAttribute} from "./attribute";
import {updateContent} from "./content";
import {updateRawContent} from "./raw-content";
import {updateTag} from "./tag";

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
    //these are tied together by the index position of the individual bindings
    markers: Array<Comment>;
    dirtyBindings: Array<boolean>;
    //these are tied together by the index position of the individual expressions
    currentExpressions: Array<unknown>;
    previousExpressions = EMPTY_ARRAY;

    // cached per-update; invalidated in update() when expressions change
    get hash(): number {
        if (this.#hash === undefined) {
            let hash = this.currentExpressions.length;
            for (const value of this.currentExpressions) {
                hash = (hash * 31 + hashValue(value)) | 0;
            }
            this.#hash = this.parsedHTML.templateHash ^ (hash * 31);
        }
        return this.#hash;
    }

    constructor(parsedHTML: ParsedHTML, expressions: Array<unknown>) {
        this.parsedHTML = parsedHTML;
        this.currentExpressions = expressions;
    }

    setup(): DocumentFragment {
        const bindingCount = this.parsedHTML.bindings.length;
        this.dirtyBindings = new Array(bindingCount);
        for (let index = 0; index < bindingCount; index++) {
            this.dirtyBindings[index] = true;
        }
        const fragment = this.parsedHTML.fragment.cloneNode(
            true,
        ) as DocumentFragment;

        this.markers = this.#findMarkers(fragment);
        this.#flush();

        return fragment;
    }

    hydrate(context: ShadowRoot) {
        const bindingCount = this.parsedHTML.bindings.length;
        this.dirtyBindings = new Array(bindingCount);
        for (let index = 0; index < bindingCount; index++) {
            this.dirtyBindings[index] = false;
        }
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

            //content nodes are there twice with the same index, so we can filter them here
            if (lastMarkerData === marker.data) {
                continue;
            }
            lastMarkerData = marker.data;
            markers.push(marker);
        }

        return markers;
    }

    update(expressions: Array<unknown>) {
        this.previousExpressions = this.currentExpressions ?? EMPTY_ARRAY;
        this.currentExpressions = expressions;
        this.#hash = undefined;

        const previousExpressions = this.previousExpressions;
        for (let index = 0; index < expressions.length; index++) {
            const currentEntry = expressions[index];
            const previousEntry = previousExpressions[index];

            if (currentEntry === previousEntry) continue;

            // Strict equality already decided for primitives; only reference
            // types need hash-based content comparison.
            const currentType = typeof currentEntry;
            const needsContentCompare =
                (currentType === "object" && currentEntry !== null) ||
                currentType === "function";

            // Arrays are reconciled per-item inside renderList via hash-based
            // identity matching. Hashing the whole list here would walk every
            // item twice per frame;
            if (Array.isArray(currentEntry)) {
                this.dirtyBindings[this.parsedHTML.expressionToBinding[index]] = true;
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

            this.dirtyBindings[this.parsedHTML.expressionToBinding[index]] = true;
        }
        this.#flush();
    }

    #flush() {
        for (let bindingIndex = 0; bindingIndex < this.dirtyBindings.length; bindingIndex++) {
            if (!this.dirtyBindings[bindingIndex]) continue;
            this.dirtyBindings[bindingIndex] = false;
            updateByType[this.parsedHTML.bindings[bindingIndex].type](
                this,
                bindingIndex,
            );
        }
    }
}
