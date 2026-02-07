# TODO

## known issues

- restoring an element removes all of its internal state (and of its children), that we would need to restore as faithfully as possible
  => eventlisteners, focus, scroll positions, animation progress

- rendering arrays currently only really works with nested html calls

## potential features

? template updating became a little ugly, it would be nice not to carry around 2 expression arrays

? maybe it would be cleaner for the parser to return a string instead of the documentFragment and we do the caching in a different step?

? should we allow for styles to be directly added as a class on a component? Have styles register in an additional way?

? We could try to isolate changes in the css and only update the specific rule

? Do we need a more precise SSR?
=> Like having a meta data comment that shows the current template hash and we walk the iterator until we find that hash?
