# Changelog

## 0.8.0

### Breaking

- **Generator signature.** `function* (host)` → `function* ({ host, …props })`. Render functions and
  inner generators receive the same object.
- **The schema** needs to be declared from the options `component(gen, { props })`.
  `component(someGenerator)` no longer inherits props from that generator.
  - The standalone function `props(element, schema)` can still be used for elements in general

### Fixed

- **A hole inside an event name is no longer dropped.** `on${eventName}=${handler}` and
  `on-${suffix}=${handler}` bound an attribute literally named `on` and discarded the hole. Both
  now compose the name and bind the event it spells, native and custom alike.
- **A composed event name binds a listener, not an IDL property.** `<button ${"onclick"}=${fn}>`
  assigned `element.onclick` while the literal spelling used `addEventListener`. Every attribute
  lane now resolves the name the same way.
