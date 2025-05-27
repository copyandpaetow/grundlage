import { createSignalReactivity } from "../../lib/src/context/signal";
import { render } from "../../lib/src/index";
import { asyncComponent } from "./components/async";
import { conditionalComponent } from "./components/conditional";
import { listComponent } from "./components/list";
import { propsComponent } from "./components/props";
import { styledComponent } from "./components/styling";

const createStores = createSignalReactivity();
const clicks = createStores.create<number>(0);

export const main = render("main-component", (_, { signal }) => {
	const stringSignal = signal.create("test");

	return render.html`
      ${render.css`
          main {
            display: grid;
            grid-auto-flow: row;
            grid-auto-rows: minmax(100px, max-content);
            gap: 2rem;
            }

		
        `}
     <main>
         ${conditionalComponent()}
         ${asyncComponent()}
				 ${listComponent()}
         ${propsComponent({
						stringSignal,
						externalSignal: clicks,
						array: [1, 2, 3, 4],
						nestedObj: { hello: "there" },
					})}
				 ${styledComponent()}

     </main>
  `;
});
