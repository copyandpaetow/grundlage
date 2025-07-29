/*

<!-- Multiple elements with same slot -->
<for- list="${items}">
  <div>${item => item.name}</div>
  <span>${item => item.id}</span>
  <div slot="empty">No items</div>
</for->

<!-- Template wrapper -->
<for- list="${items}">
  <template slot="item">
    <div>${item => item.name}</div>
    <span>${item => item.id}</span>
  </template>
</for->

// Your restoration system does:
forElement.setItemTemplate((item, container) => { 
  container.querySelector('[data-replace="0"]').replaceWith(new Text(bindings[0].value(item)));
  container.querySelector('[data-replace="1"]').replaceWith(new Text(bindings[1].value(item)));
  // ... etc
});

// Component just does:
items.forEach(item => {
  const clone = this.template.cloneNode(true);
  this.itemTemplateCallback(item, clone);
  this.appendChild(clone);
});


*/

import { Result } from "./html";
import { updateDynamicParts } from "./render";

export class ForEachComponent extends HTMLElement {
	#bindings: Result["bindings"] = [];

	constructor() {
		super();
		if (!this.shadowRoot) {
			this.attachShadow({ mode: "open", clonable: true, serializable: true });
		}
		this.#extractTemplates();
		//create a template for the item elements
		//this should be available as method/property if this element is programmatically created
	}

	#extractTemplates() {
		// if (!this.shadowRoot?.querySelector("[slot='empty']")) {
		// 	const emptyElement = this.querySelector("[slot='empty']");
		// 	if (emptyElement) {
		// 		this.shadowRoot!.append(emptyElement);
		// 	}
		// }

		if (this.shadowRoot?.querySelector("[slot='item']")) {
			return;
		}

		const template = document.createElement("template");
		template.setAttribute("slot", "item");
		template.content.append(...this.childNodes);
		this.shadowRoot!.append(template);
	}

	setBindings(bindings: Result["bindings"]) {
		this.#bindings = bindings;
		this.#update();
	}

	#update() {
		const sourceArray = this.#bindings.find(
			(entry) => entry.type === "ATTR" && entry.key.join("") === "list"
		);
		const template = this.shadowRoot?.querySelector(
			"[slot='item']"
		) as HTMLTemplateElement;
		sourceArray?.value.at(0)?.forEach((entry) => {
			const content = template.content.cloneNode(true) as DocumentFragment;
			updateDynamicParts(content, this.#bindings, () => entry);
			this.shadowRoot?.append(content);
			console.log({ content, template });
		});
	}
}

if (!customElements?.get("for-each")) {
	customElements.define("for-each", ForEachComponent);
}
