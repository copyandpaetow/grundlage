# Changelog

## 0.8.0

### Breaking

- **Generator signature.** `function* (host)` → `function* ({ host, …props })`. Render functions and
  inner generators receive the same object.
- **The schema** needs to be declared from the options `component(gen, { props })`.
  `component(someGenerator)` no longer inherits props from that generator.
  - The standalone function `props(element, schema)` can still be used for elements in general
