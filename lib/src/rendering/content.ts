import { ContentDescriptor } from "../parser/parser-html";
import { HTMLTemplate } from "./template-html";
import { toPrimitive } from "../utils/to-primitve";
import { hashValue } from "../utils/hashing";

function diff(oldList: Array<HTMLTemplate>, newList: Array<HTMLTemplate>) {
	const oldHashes = new Set(oldList.map(hashValue));
	const newHashes = new Set(newList.map(hashValue));

	const current = oldList.map(hashValue);
	const operations = [];

	let oldIndex = 0;
	let newIndex = 0;

	while (oldIndex < current.length || newIndex < newList.length) {
		const currentHash = oldIndex < current.length ? current[oldIndex] : null;
		const newHash =
			newIndex < newList.length ? hashValue(newList[newIndex]) : null;

		if (currentHash === null && newHash === null) {
			break;
		}

		if (currentHash === newHash) {
			oldIndex++;
			newIndex++;
			continue;
		}

		if (currentHash === null) {
			operations.push({ index: newIndex, type: "add" });
			newIndex++;
			continue;
		}

		if (newHash === null) {
			operations.push({ index: oldIndex, type: "delete" });
			oldIndex++;
			continue;
		}

		const newExistsInOld = oldHashes.has(newHash);
		const currentExistsInNew = newHashes.has(currentHash);

		if (!currentExistsInNew) {
			operations.push({ index: oldIndex, type: "delete" });
			current.splice(oldIndex, 1);
			continue;
		}

		if (!newExistsInOld) {
			if (newList.length === operations.length) {
				operations.push({ index: newIndex, type: "replace" });
				current[oldIndex] = newHash;
			} else {
				operations.push({ index: newIndex, type: "add" });
				current.splice(oldIndex, 0, newHash);
			}

			oldIndex++;
			newIndex++;
			continue;
		}

		const swapTarget = current.indexOf(newHash, oldIndex + 1);
		operations.push({ index: oldIndex, type: "swap", with: swapTarget });
		[current[oldIndex], current[swapTarget]] = [
			current[swapTarget],
			current[oldIndex],
		];
		oldIndex++;
		newIndex++;
	}

	return operations;
}

const collectMarker = (listMarker: Comment) => {
	const markers: Array<{ start: Comment; end: Comment }> = [];

	let current = listMarker.nextSibling;
	let start: Comment | null = null;
	while (current) {
		if (current.nodeType !== Node.COMMENT_NODE) {
			current = current.nextSibling;
			continue;
		}

		if ((current as Comment).data === listMarker.data) {
			break;
		}

		if (start?.data === (current as Comment).data) {
			markers.push({ start, end: current as Comment });
			start = null;
			current = current.nextSibling;
			continue;
		}

		start = current as Comment;
		current = current.nextSibling;
	}

	return markers;
};

export class ContentBinding {
	#descriptor: ContentDescriptor;
	#marker: Comment;
	#updateId = -1;

	constructor(descriptor: ContentDescriptor, marker: Comment) {
		this.#descriptor = descriptor;
		this.#marker = marker;
	}

	update(context: HTMLTemplate) {
		if (this.#updateId === context.updateId) {
			return;
		}
		this.#updateId = context.updateId;

		if (this.#descriptor.values.length > 1) {
			this.#delete(this.#marker);
			this.#marker.after(new Comment(this.#createComment(context)));
			return;
		}

		const index = this.#descriptor.values[0] as number;

		const current = context.currentExpressions[index];
		const previous = context.previousExpressions[index];

		//if the new value is a renderTemplate, we need to check if the old one is also a renderTemplate and if they have the same templateHash
		if (current instanceof HTMLTemplate) {
			if (
				previous instanceof HTMLTemplate &&
				previous.parsedHTML.templateHash === current.parsedHTML.templateHash
			) {
				//if they do, we can update the old one just with new dynamic values
				previous.update(current.currentExpressions);
				//to not lose the reference we need to keep it in the currentValeus
				context.currentExpressions[index] = previous;
				return;
			}

			//otherwise we delete the old dom and render again
			this.#delete(this.#marker);
			this.#marker.after(current.setup());
			return;
		}

		if (Array.isArray(current)) {
			let oldList = [];
			if (Array.isArray(previous)) {
				oldList = previous;
			} else if (previous) {
				oldList.push(previous);
			}

			const operations = diff(oldList, current);
			const markers = collectMarker(this.#marker);

			for (const operation of operations) {
				if (operation.type === "add") {
					const start = new Comment("list" + operation.index);
					const end = new Comment("list" + operation.index);
					const content = (current[operation.index] as HTMLTemplate).setup();

					const insertAfter = markers[operation.index - 1]?.end || this.#marker;
					insertAfter.after(start, content, end);
					markers.splice(operation.index, 0, { start, end });
				} else if (operation.type === "replace") {
					//todo: we need to investigate if it makes sense to update the template instead of moving dom nodes

					const marker = markers[operation.index];
					this.#delete(marker.start, marker.end);
					const content = (current[operation.index] as HTMLTemplate).setup();
					marker.start.after(content);
				} else if (operation.type === "delete") {
					const marker = markers[operation.index];
					this.#delete(marker.start, marker.end);
					marker.start.remove();
					marker.end.remove();
					markers.splice(operation.index, 1);
				} else if (operation.type === "swap") {
					//todo: we need to investigate if it makes sense to update the template instead of moving dom nodes
					const markerA = markers[operation.index];
					const markerB = markers[operation.with!];
					const nodesA = this.#getNodesBetween(markerA.start, markerA.end);
					const nodesB = this.#getNodesBetween(markerB.start, markerB.end);
					markerA.start.after(...nodesB);
					markerB.start.after(...nodesA);
				}
			}

			return;
		}

		this.#delete(this.#marker);
		this.#marker.after(document.createTextNode(toPrimitive(current)));
	}

	#createComment(context: HTMLTemplate) {
		let commentData = "";
		//the first and last entries are the comment markers
		for (let index = 1; index < this.#descriptor.values.length - 1; index++) {
			const entry = this.#descriptor.values[index];
			commentData +=
				typeof entry === "number"
					? toPrimitive(context.currentExpressions[entry])
					: entry;
		}
		return commentData;
	}

	#delete(start: Comment, end?: Comment) {
		let current = start.nextSibling;

		while (current) {
			const isComment = current.nodeType === Node.COMMENT_NODE;
			const isLastComment =
				current === end || (current as Comment)?.data === start.data;

			if (!isComment) {
				current = current.nextSibling;
				continue;
			}

			if (isLastComment) {
				break;
			}

			const next = current.nextSibling;
			current.remove();
			current = next;
		}
	}

	#getNodesBetween(start: Node, end: Node) {
		const nodes = [];

		let current = start.nextSibling;
		while (current && current !== end) {
			nodes.push(current);
			current = current.nextSibling;
		}
		return nodes;
	}
}
