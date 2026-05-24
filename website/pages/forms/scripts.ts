import "../../src/components/form-field";
import "../../src/components/navbar";

const form = document.getElementById("demo") as HTMLFormElement;
const fields = document.getElementById("fields") as HTMLFieldSetElement;
const result = document.getElementById("result") as HTMLElement;

form.addEventListener("submit", (event) => {
	event.preventDefault();
	// the <form-field> value lands in FormData only because the component called
	// internals.setFormValue under its name attribute
	const data = new FormData(form);
	result.textContent = JSON.stringify(Object.fromEntries(data));
});

document.getElementById("toggle-disabled")?.addEventListener("click", () => {
	// disabling the fieldset makes the browser call formDisabledCallback on the
	// form-associated component, which it re-broadcasts as on-form-disabled
	fields.disabled = !fields.disabled;
});
