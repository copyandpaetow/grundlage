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
    /*
        Tracks which bindings need a DOM update this cycle.
        Uses a bitmask to avoid object/GC overhead on every update
        Each bit position corresponds to a binding index.
        A Uint32Array of ⌈bindings.length / 32⌉ words covers any component size.
        Operations: set a bit with [i >> 5] |= 1 << (i & 31), clear all with .fill(0).
    */
    dirtyBindings: Uint32Array;
    //these are tied together by the index position of the individual expressions
    currentExpressions: Array<unknown>;
    previousExpressions = EMPTY_ARRAY;

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
        this.dirtyBindings = new Uint32Array(
            ((this.parsedHTML.bindings.length - 1) >> 5) + 1,
        );
        for (const bindingIndex of this.parsedHTML.expressionToBinding) {
            this.dirtyBindings[bindingIndex >> 5] |= 1 << (bindingIndex & 31);
        }
        const fragment = this.parsedHTML.fragment.cloneNode(
            true,
        ) as DocumentFragment;

        this.markers = this.#findMarkers(fragment);
        this.#flush();

        return fragment;
    }

    hydrate(context: ShadowRoot) {
        this.dirtyBindings = new Uint32Array(
            ((this.parsedHTML.bindings.length - 1) >> 5) + 1,
        );
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
            {acceptNode: () => NodeFilter.FILTER_ACCEPT},
        );

        let lastBindingIndex = "";
        while (treeWalker.nextNode()) {
            const marker = treeWalker.currentNode as Comment;

            if (!marker.data.startsWith(COMMENT_IDENTIFIER)) {
                continue;
            }

            //content nodes are there twice with the same index, so we can filter them here
            if (lastBindingIndex === marker.data) {
                continue;
            }
            lastBindingIndex = marker.data;
            markers.push(marker);
        }

        return markers;
    }

    update(expressions: Array<unknown>) {
        this.previousExpressions = this.currentExpressions ?? EMPTY_ARRAY;
        this.currentExpressions = expressions;
        let hash = expressions.length;

        for (let index = 0; index < expressions.length; index++) {
            const currentEntry = this.currentExpressions[index];
            const previousEntry = this.previousExpressions[index];
            const currentHash = hashValue(currentEntry);
            hash = (hash * 31 + currentHash) | 0;

            if (currentEntry === previousEntry) {
                continue;
            }

            if (currentHash === hashValue(previousEntry)) {
                if (this.currentExpressions[index] instanceof HTMLTemplate) {
                    this.currentExpressions[index] = this.previousExpressions[index];
                }
                continue;
            }

            const bindingIndex = this.parsedHTML.expressionToBinding[index];
            this.dirtyBindings[bindingIndex >> 5] |= 1 << (bindingIndex & 31);
        }
        this.#hash = this.parsedHTML.templateHash ^ (hash * 31);
        this.#flush();
    }

    #flush() {
        for (let word = 0; word < this.dirtyBindings.length; word++) {
            let bits = this.dirtyBindings[word];
            while (bits !== 0) {
                const lowestBit = bits & -bits;
                const bindingIndex = (word << 5) + 31 - Math.clz32(lowestBit);
                updateByType[this.parsedHTML.bindings[bindingIndex].type](
                    this,
                    bindingIndex,
                );
                bits ^= lowestBit;
            }
        }
        this.dirtyBindings.fill(0);
    }
}
