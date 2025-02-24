import { render } from "../../../../lib/src/index";
import { css } from "../../../../lib/src/template/css";

const style = css`
  :host {
    padding: 10px;
  }
`;

const currentClass = css`
  padding: 10px;
`;

const otherClass = css`
  ${currentClass}
  color: red
`;

const otherStyle = css`
  ${style}

  .card {
    margin: 2px;
    ${otherClass}
  }

  .card .${otherClass} {
    color: blue;
  }
`;
// console.log({ style, currentClass, otherClass, otherStyle });

// const createStores = createSignalReactivity();
// const clicks = createStores.create<number>(0);

// createStores.computed(() => {
//   console.log(clicks[0]());
// });

const promiseFactory = () =>
  new Promise((resolve) =>
    setTimeout(() => resolve("save results are safe"), 1000)
  );

const riskyPromiseFactory = () =>
  new Promise((resolve, reject) =>
    setTimeout(
      () => (Math.random() > 0.5 ? resolve("success") : reject("error")),
      5000
    )
  );

const superRiskyPromiseFactory = () =>
  new Promise((resolve, reject) =>
    setTimeout(
      () =>
        Math.random() > 0.75 ? resolve("1 in a Million") : reject("expected"),
      20000
    )
  );

const asyncComponent = render("async-component", (_, { signal }) => {
  const [startPromiseChain, setStartPromiseChain] = signal.create(false);
  const [savePromise, updateSafePromise] = signal.createAsync(
    promiseFactory,
    startPromiseChain
  );
  const [riskyPromise, updateRiskyPromise] = signal.createAsync(
    riskyPromiseFactory,
    savePromise
  );

  const refetchOuterPromise = () => {
    savePromise.refetch();
  };
  const refetchInnerPromise = () => {
    riskyPromise.refetch();
  };

  const updatePromise = () => {
    updateRiskyPromise(superRiskyPromiseFactory);
  };

  return render.html`
  <button onclick="${() => setStartPromiseChain(true)}">start chain</button>
  <button onclick="${refetchOuterPromise}">refetch outer promise</button>
  <button onclick="${refetchInnerPromise}">refetch inner promise</button>
  <button onclick="${updatePromise}">update promise</button>
  <br />
<template suspense=${savePromise} id=1>
  <div>safe result: ${(value) => value}</div>

     <template suspense=${riskyPromise} id=2>
         <div>risky result: ${(value) => value}</div>
         <template slot="fallback" id=22>loading risky</template>
         <template slot="error" id=23>too risky</template>
     </template>

     <div slot="fallback" id=11>loading safe</div>
     <div slot="error" id=12>how does this even happen?</div>
</template>

  `;
});

const shuffleArray = (iterable) =>
  iterable
    .map((entry) => ({ entry, shuffler: Math.random() }))
    .toSorted((a, b) => a.shuffler - b.shuffler)
    .map((shuffledEntry) => shuffledEntry.entry);

const listComponent = render("list-component", (_, { signal }) => {
  const [list, updateList] = signal.create<Array<number>>([10, 20, 30, 40, 50]);

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

  signal.computed(() => {
    console.log(list());
  });

  return render.html`
  <button onclick="${shuffle}">shuffle</button>
  <button onclick="${appendSum}">append sum</button>
  <button onclick="${addRandomSum}">append random sum</button>
  <button onclick="${removeRandom}">remove random</button>
  <br />
  <ul>
   <template each=${list} id=1 >

        <li slot="item">simple list: ${(value) => value}</li>

       <p>${() => list().length} items</p>
     <template slot="empty" id=11><li>list is empty</li></template>
     <template slot="error" id=12>how does this even happen? ${(error) => error?.message || error}</template>
</template>
  </ul>
  `;
});

const conditionalComponent = render(
  "conditional-component",
  (_, { signal }) => {
    const [value, updateValue] = signal.create(1);

    const addOne = () => {
      updateValue((prev) => prev + 1);
    };
    const removeOne = () => {
      updateValue((prev) => prev - 1);
    };

    signal.computed(() => {
      console.log(value());
    });

    return render.html`
  <button onclick="${addOne}">add one</button>
  <button onclick="${removeOne}">remove one</button>
  <br />

   <template when=${() => value() > 0} id=1 beforeRender=${(res) => console.log(res)}>
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

export const main = render("main-component", () => {
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
     </main>
  `;
});
