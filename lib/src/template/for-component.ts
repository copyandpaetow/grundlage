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

export class ForEachComponent extends HTMLElement {
	template = new DocumentFragment();
	emptyTemplate = new DocumentFragment();
	#bindings: Result["bindings"] = [];

	constructor() {
		super();
		this.attachShadow({ mode: "closed" });

		//create a template for the item elements
		//this should be available as method/property if this element is programmatically created
	}

	setBindings(bindings: Result["bindings"]) {
		this.#bindings = bindings;
	}
}

if (!customElements?.get("for-each")) {
	customElements.define("for-each", ForEachComponent);
}
