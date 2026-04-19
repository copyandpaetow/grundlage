import {html} from "../parser/html";
import {bindingToString} from "../utils/binding-to-string";
import {isStringable, toPrimitive} from "../utils/to-primitive";
import {isComment, isSameTemplate} from "../utils/validators";
import {HTMLTemplate} from "./template-html";

const deleteNodesBetween = (start: Node, end?: Node) => {
    let current = start.nextSibling;

    while (current) {
        //list markers all have the same data, if we find another comment with the same data as our marker, we found the start of the next entry
        const isLastComment =
            current === end || (isComment(current) && current.data === (start as Comment).data);

        if (isLastComment) {
            break;
        }

        const next = current.nextSibling;
        current.remove();
        current = next;
    }
};

const toTemplateList = (list: Array<unknown>): Array<HTMLTemplate> => {
    for (let index = 0; index < list.length; index++) {
        const element = list[index];
        if (!(element instanceof HTMLTemplate)) {
            list[index] = html`${element}`;
        }
    }
    return list as Array<HTMLTemplate>;
};

const LIST_IDENTIFIER = "*.*"; //small enough to save space but unique enough to not collide with potential user comments
const EMPTY_PREVIOUS: ReadonlyArray<HTMLTemplate> = [];

const isListMarker = (node: Node): node is Comment =>
    isComment(node) && node.data === LIST_IDENTIFIER;

const removeItemDom = (itemMarker: Comment, listContainerMarker: Comment) => {
    let current: ChildNode | null = itemMarker;
    while (current) {
        const prev = current.previousSibling as ChildNode | null;
        current.remove();
        // Stop at a per-item marker (next item above) or the outer list
        // container marker — crossing the container marker would delete the
        // binding's own anchor and corrupt subsequent renders.
        if (!prev || prev === listContainerMarker || isListMarker(prev)) return;
        current = prev;
    }
};

const isAlreadyInPosition = (position: Node, itemMarker: Comment) => {
    let scan: Node | null = itemMarker.previousSibling;
    while (scan && scan !== position) {
        if (isListMarker(scan)) return false;
        scan = scan.previousSibling;
    }
    return scan === position;
};

const moveItemAfter = (position: ChildNode, itemMarker: Comment) => {
    let current: ChildNode | null = itemMarker;
    while (current) {
        const prev = current.previousSibling as ChildNode | null;
        position.after(current);
        if (!prev || isListMarker(prev)) return;
        current = prev;
    }
};

const renderList = (
    context: HTMLTemplate,
    marker: Comment,
    expressionIndex: number,
) => {
    const previousValue = context.previousExpressions[expressionIndex];
    const current = toTemplateList(
        context.currentExpressions[expressionIndex] as Array<unknown>,
    );
    const trackedPrevious = (Array.isArray(previousValue)
        ? previousValue
        : EMPTY_PREVIOUS) as Array<HTMLTemplate>;

    // Walk the current DOM once, collecting per-item markers. The DOM is the
    // source of truth: if it's shorter than the tracked array (e.g. the slot
    // was cleared between renders), we treat the tail as absent.
    const previousMarkers: Array<Comment> = [];
    const hashToPrevIndex = new Map<number, number>();
    let sibling: Node | null = marker.nextSibling;
    while (sibling) {
        if (isComment(sibling) && sibling.data === marker.data) break;
        if (isListMarker(sibling) && previousMarkers.length < trackedPrevious.length) {
            const previousIndex = previousMarkers.length;
            previousMarkers.push(sibling);
            hashToPrevIndex.set(trackedPrevious[previousIndex].hash, previousIndex);
        }
        sibling = sibling.nextSibling;
    }

    const previousLength = previousMarkers.length;

    // currentToPrev[index] = -1 if current[index] needs a fresh DOM node, otherwise the
    // previous index whose DOM (and template instance) should be reused.
    // Both views share one ArrayBuffer — for components with many small lists
    // updating per frame, that halves the buffer allocations versus two
    // independent typed arrays.
    const bookkeeping = new ArrayBuffer(current.length * 4 + previousLength);
    const currentToPrev = new Int32Array(bookkeeping, 0, current.length);
    const previousClaimed = new Uint8Array(bookkeeping, current.length * 4, previousLength);

    // Pass 1: hash-identity matches. These preserve DOM identity across reorder,
    // insert, delete, and swap — the existing contract.
    for (let index = 0; index < current.length; index++) {
        const match = hashToPrevIndex.get(current[index].hash);
        if (match !== undefined && !previousClaimed[match]) {
            currentToPrev[index] = match;
            previousClaimed[match] = 1;
        } else {
            currentToPrev[index] = -1;
        }
    }

    // Pass 2: structural fallback. When current[i] has no hash twin, an
    // unclaimed previous[i] with the same parsed template can be updated in
    // place — no clone, no new marker, no DOM insertion.
    for (let index = 0; index < current.length; index++) {
        if (currentToPrev[index] !== -1) continue;
        if (
            index < previousLength &&
            !previousClaimed[index] &&
            trackedPrevious[index].parsedHTML === current[index].parsedHTML
        ) {
            currentToPrev[index] = index;
            previousClaimed[index] = 1;
        }
    }

    // Pass 3: apply — reuse matched items (moving DOM only when necessary),
    // build fresh items for the rest.
    let position: ChildNode = marker;
    let expectedPreviousIndex = 0;
    for (let index = 0; index < current.length; index++) {
        const template = current[index];
        const previousIndex = currentToPrev[index];

        if (previousIndex === -1) {
            const listItemMarker = new Comment(LIST_IDENTIFIER);
            position.after(template.setup(), listItemMarker);
            position = listItemMarker;
            continue;
        }

        const reusedTemplate = trackedPrevious[previousIndex];
        if (reusedTemplate.hash !== template.hash) {
            reusedTemplate.update(template.currentExpressions);
        }
        current[index] = reusedTemplate;

        const itemMarker = previousMarkers[previousIndex];
        // Monotonic reuse (the steady state for "same list, values changed")
        // means the existing DOM is already in place — no need to walk
        // siblings to verify. Only reach for isAlreadyInPosition/moveItemAfter
        // when a reorder could have happened.
        if (previousIndex !== expectedPreviousIndex) {
            if (!isAlreadyInPosition(position, itemMarker)) {
                moveItemAfter(position, itemMarker);
            }
        }
        expectedPreviousIndex = previousIndex + 1;
        position = itemMarker;
    }

    // Pass 4: drop whatever was not claimed.
    for (let index = 0; index < previousLength; index++) {
        if (!previousClaimed[index]) {
            removeItemDom(previousMarkers[index], marker);
        }
    }
};

const renderTemplate = (
    context: HTMLTemplate,
    marker: Comment,
    expressionIndex: number,
) => {
    const current = context.currentExpressions[expressionIndex] as HTMLTemplate;
    const previous = context.previousExpressions[expressionIndex];

    if (previous instanceof HTMLTemplate && isSameTemplate(current, previous)) {
        //if they do, we can update the old one just with new dynamic values
        previous.update(current.currentExpressions);
        //to not lose the reference we need to keep it in the currentValeus
        context.currentExpressions[expressionIndex] = previous;
        return;
    }

    deleteNodesBetween(marker);
    marker.after(current.setup());
    //otherwise we delete the old dom and render again
    return;
};

const renderComment = (
    context: HTMLTemplate,
    marker: Comment,
    bindingValues: Array<string | number>,
) => {
    deleteNodesBetween(marker);
    marker.after(
        new Comment(bindingToString(bindingValues, context.currentExpressions)),
    );
};

export const updateContent = (context: HTMLTemplate, bindingIndex: number) => {
    const binding = context.parsedHTML.bindings[bindingIndex];
    const marker = context.markers[bindingIndex];

    //only comments can have multiple bindings, normal content only has one
    if (binding.values.length > 1) {
        renderComment(context, marker, binding.values);
        return;
    }

    const expressionIndex = binding.values[0] as number;
    const current = context.currentExpressions[expressionIndex];

    if (current == null) {
        deleteNodesBetween(marker);
        return;
    }

    if (current instanceof HTMLTemplate) {
        renderTemplate(context, marker, expressionIndex);
        return;
    }

    if (Array.isArray(current)) {
        renderList(context, marker, expressionIndex);
        return;
    }

    const renderableCurrent = toPrimitive(current);
    const previous = context.previousExpressions[expressionIndex];

    if (previous === undefined) {
        marker.after(document.createTextNode(renderableCurrent));
        return;
    }

    if (isStringable(previous)) {
        (marker.nextSibling as Text).data = renderableCurrent;
        return;
    }

    deleteNodesBetween(marker);
    marker.after(document.createTextNode(renderableCurrent));
};
