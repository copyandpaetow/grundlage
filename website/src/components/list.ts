import { render } from "../../../lib/src";

const shuffleArray = (iterable: Array<number>) =>
	iterable
		.map((entry) => ({ entry, shuffler: Math.random() }))
		.toSorted((a, b) => a.shuffler - b.shuffler)
		.map((shuffledEntry) => shuffledEntry.entry);

export const listComponent = render(
	"list-component",
	({ numbers }, { signal }) => {
		const [list, updateList] = signal.create<Array<number>>([
			10, 20, 30, 40, 50,
		]);

		const shuffle = () => {
			updateList((prev) => shuffleArray(prev));
		};
		const appendSum = () => {
			updateList((prev) => prev.concat(prev.reduce((acc, curr) => acc + curr)));
		};
		const removeRandom = () => {
			updateList((prev) => {
				const random = Math.floor(Math.random() * Math.floor(prev.length));
				const newArray = prev.toSpliced(random, 1);
				return newArray;
			});
		};
		const addRandomSum = () => {
			updateList((prev) => {
				const newArray = shuffleArray(
					prev.concat(prev.reduce((acc, curr) => acc + curr))
				);
				return newArray;
			});
		};

		// signal.computed(() => {
		// 	console.log(list());
		// });

		return render.html`
  <button onclick="${shuffle}">shuffle</button>
  <button onclick="${appendSum}">append sum</button>
  <button onclick="${addRandomSum}">append random sum</button>
  <button onclick="${removeRandom}">remove random</button>
  <br />
  <ul>
   <template each=${list} id=1 >

        <li slot="item">simple list: ${(value: string) => value}</li>

       <p>${() => list().length} items</p>
     <template slot="empty" id=11><li>list is empty</li></template>
     <template slot="error" id=12>how does this even happen? ${(error: Error) =>
				error?.message || error}</template>
</template>
  </ul>
  `;
	}
);
