# TODO

## features

## known issues

### tags

- restoring an element removes all of its internal state (and of its children), that we would need to restore as
  faithfully as possible
  => eventListeners, focus, scroll positions, animation progress
- Dont update the tag if it is identical

### attributes

- we can detect the kind of attribute inside the parser already and need to do less work in the attribute handling
- we can diff the attributes created in the case of name-only attributes (array or object) so we only change the ones
  that changed
    - it might be the case that the browser automatically does that
    - maybe we could ignore any attributes where old === new
- multi-value attr with function won't clean up listener

### list rendering

- we need an alternative to the user data manipulation
- In-place array mutation silently skips re-render since the identity is still the same

### parser

- centralize parser scope reset, so selfClosing = false is centralized as well as flushing of buffer arrays

## potential features

? maybe it would be cleaner for the parser to return a string instead of the documentFragment and we do the caching in a
different step?

? should we allow for styles to be directly added as a class on a component? Have styles register in an additional way?

? We could try to isolate changes in the CSS and only update the specific rule
