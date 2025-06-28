import { render } from "../../../lib/src";

export const conditionalComponent = render(
	"conditional-component",
	(_, { signal }) => {
		const [value, updateValue] = signal.create(1);

		const addOne = () => {
			updateValue((prev) => prev + 1);
		};
		const removeOne = () => {
			updateValue((prev) => prev - 1);
		};

		// signal.computed(() => {
		// 	console.log(value());
		// });

		return render.html`
  <button onclick="${addOne}">add one</button>
  <button onclick="${removeOne}">remove one</button>
  <br />

   <template when=${() => value() > 0} id=1>
     <div>is visible: ${value}</div>

     <template slot="fallback" when=${() => value() > -1}>
         <div>conditional fallback</div>
     </template>

     <template slot="fallback" >
        <div>general fallback template</div>
     </template>

      <div id="test-fallback" slot="fallback">general fallback</div>
   </template>
  `;
	}
);
