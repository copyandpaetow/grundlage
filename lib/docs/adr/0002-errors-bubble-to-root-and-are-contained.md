# Errors bubble to the root generator and fail loud-but-contained

An error thrown anywhere in a component (a yielded render function, an inner generator,
an awaited `load`, a missing required prop) is re-thrown **into the root generator at its
current yield point**. Recovery is therefore plain `try/catch` in the generator — there is
no error-boundary API and no `onError` option. If nothing catches it, the runtime
`console.warn`s and writes the error text into the component's shadow root, preserves any
previously-rendered DOM, and tears down only that component — the host page keeps running.

## Why

The library deliberately occupies the JS-land "fail fast, be visible" position, while the
component *boundary* gives HTML/CSS-land "be forgiving": failure is contained to one
element and the author opts into graceful degradation through the language's own
`try/catch` rather than a framework construct. This single model serves both an island
dropped into someone else's page and a site authored entirely in the framework, with no
dev/prod switch and no new surface area — the recovery primitive *is* the language.

## Considered Options

- **Bubble to root + `try/catch` recovery (chosen).** Recovery uses vanilla control flow;
  zero added API.
- **Error-boundary / `onError` callback.** Rejected: more surface, a bespoke construct,
  and less expressive than `try/catch` around the exact code that can fail.
- **Swallow / render last-good silently.** Rejected: hides bugs; "some error is better than
  no error."

On the uncaught case specifically we keep writing the raw error into the shadow root
(loud) rather than logging to the console only. Because there is no build-time
environment, loud-by-default is the honest choice; a component that wants a clean
production fallback adds one `try/catch`. The cost — an uncaught error can surface raw
text to end users in a production island — is accepted in exchange for never silently
hiding a failure.

## Consequences

- A child component's throw resurfaces in its parent generator. This is not obvious from
  the call site and is the main thing a new reader will be surprised by.
- "Required-by-default" props are consistent with this contract: a missing required prop
  is a loud-but-recoverable signal, not a dead end.
