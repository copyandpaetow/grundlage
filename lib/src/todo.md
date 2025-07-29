# TODOs

## css

- add a css parser like this. This would likely influence the html parser and the final rendering so we should do it first

```ts
type CssResult = {
	className: string; // "css-abc123"
	styleSheet: string; // ":host { padding: 10px; } .css-abc123 { color: red; }"
	toString(): string; // returns className for template usage
};
```

## render

- we need a better, recursive rendering strategy
- depending on the attribute renderer, we might need to add another variant here, which could influence the html parser

## html

- cleanup is needed as we likely dont need a type
- we also handle attributes mostly the same, we could likely reduce some code here
- there is the case that the html`` call will get used within another. Would we return the string or the fragment? Or just a "hole"?
- there is some duplicated work done with the attributes, maybe we can abstract this a bit

## signals

- research if we can move closer to the components than the current iteration. We likely can benefit from the html lifecycles

## components

### general

- we are currently looking for the name of a certain attribute for the components, this we could maybe improve
- the functionality of moving the lightDom children into the templates could maybe be abstracted

### for-each

- add keyFn to for-each component
- add list sorting logic to for-each component

### when-else

- add when-else/if-then component

### suspense-boundary

- add suspense-boundary component
