# TODO

## features

## known issues

- restoring an element removes all of its internal state (and of its children), that we would need to restore as
  faithfully as possible
  => eventListeners, focus, scroll positions, animation progress
- we can diff the attributes created in the case of name-only attributes (array or object) so we only change the ones
  that changed
  - it might be the case that the browser automatically does that

## potential features

? maybe it would be cleaner for the parser to return a string instead of the documentFragment and we do the caching in a
different step?

? should we allow for styles to be directly added as a class on a component? Have styles register in an additional way?

? We could try to isolate changes in the CSS and only update the specific rule

? Do we need a more precise SSR?
=> Like having a metadata comment that shows the current template hash, and we walk the iterator until we find that
hash?
=> return with the first renderable content?
=> stream the inner content?

? a toplevel template element that mirrors its attributes to the web-component/host element
=> just for the top level generator function
=> we would need to adapt the attribute checking of the MO as we write that

? form handling via events?
