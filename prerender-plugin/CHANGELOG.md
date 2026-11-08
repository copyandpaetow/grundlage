# Changelog

## Unreleased

### Breaking

- The plugin needs grundlage 0.9.
- Every page prerenders by default.
- `include` and `exclude` are page globs, not module globs.
- `ssr` is inherited by everything inside the element, and `ssr="false"` opts out.
- The `sentinelAttribute` option is removed: mark elements with `ssr` instead.
- Components come from the modules a page's scripts import, not from a scan of every source file.
- An `ssr` value other than empty, `true` or `false` throws.

### Added

- `ssr="false"` works below a prerendered root; grundlage components there don't run on the server.
- The render waits for `pending-task` events, so nested components that wait before their first paint ship painted.

### Changed

- A component that throws on the server is left for the browser with one warning, and its siblings still ship.
- `firstYieldTimeoutMs` covers nested waits too.
- A root that isn't serializable stays out quietly unless the element carries `ssr` itself.
- In dev, components load through the dev server, so an edit shows up on the next request; `componentLoader` applies to builds only.
- A component that paints nothing and announces no `pending-task` warns without claiming a wait.
- Warnings say "left for the browser" instead of "rendering on client".
- Node 22.12 or newer is enough, down from 24.

### Fixed

- Shadow roots ship with the `delegatesFocus` and `clonable` their component asked for.
