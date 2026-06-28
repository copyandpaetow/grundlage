import "../../src/components/raf-animation-list";
import "../../src/components/navbar";

// One live <raf-animation-list> at a time. Changing the bar count remounts it
// (bar count is read once at setup), so a second animation loop never runs
// alongside the one being measured.
const input = document.getElementById("bar-count") as HTMLInputElement;
const mount = document.getElementById("mount") as HTMLElement;

const remount = () => {
	mount.replaceChildren();
	const element = document.createElement("raf-animation-list");
	element.setAttribute("bars", input.value);
	mount.appendChild(element);
};

input.addEventListener("change", remount);
remount();
