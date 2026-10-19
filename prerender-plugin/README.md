# vite-plugin-grundlage

A Vite plugin that renders [grundlage](https://github.com/copyandpaetow/grundlage) components on the server and
inlines the result into the HTML as declarative shadow DOM. Markup and styles are there when the HTML is first
parsed, and in the browser grundlage hydrates that markup instead of painting it again.

Own package, own version, and a lot younger than the library, so the API can still move between minor versions.
Nothing here is needed to use grundlage itself.

## introduction

### getting started

#### installation

```bash
npm install --save-dev vite-plugin-grundlage
```

- Vite 8 as a peer dependency
- Node 22.12 or newer
- happy-dom comes along as a dependency, it is the DOM the components render into on the server

#### example

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { prerenderWebcomponents } from "vite-plugin-grundlage";

export default defineConfig({
	plugins: [prerenderWebcomponents()],
});
```

```html
<click-counter start="3"></click-counter>
<!-- prerendered: every page is, by default -->
<click-counter start="3" ssr="false"></click-counter>
<!-- left as written, painted in the browser -->
```

### concepts

#### pages set the default, elements override it

Every page prerenders unless `include` and `exclude` say otherwise. Both take page globs relative to the Vite
root, and `include: []` prerenders no page, so only the elements that ask for it with `ssr` do:

```typescript
prerenderWebcomponents({
	include: ["index.html", "blog/**/*.html"],
	exclude: ["blog/drafts/**"],
});
```

On the page, `ssr` (or `ssr="true"`) turns prerendering on and `ssr="false"` turns it off. It goes on `<html>`,
`<body>` or a custom element, and everything inside inherits it, through shadow roots too, until another `ssr`
says otherwise. In a component's template it works on any element. Any other value throws and names the ones
that work.

```html
<body ssr="false">
	<site-header ssr></site-header>
	<!-- prerendered -->
	<live-dashboard></live-dashboard>
	<!-- painted in the browser -->
</body>
```

A grundlage component under `ssr="false"` doesn't run on the server at all: grundlage dispatches a cancelable
`grundlage-render` event before a component's first run on the server, and the plugin cancels it there. The
attribute stays in the output.

#### components come from the page's scripts

The modules a page's `<script type="module">` imports, inline or through `src`, run on the server, and the tags
they define are the ones that prerender. The script's own body never runs there, since it wires up the page. A
component defined in the page script itself stays in the browser, with a warning: define it in a module the page
imports. Classic scripts and external URLs are not loaded.

#### the module loader

In dev, component modules load through the dev server, and an edit shows up on the next request. A build loads
them through Vite's own SSR pipeline as well, so TypeScript, extensionless and directory imports, aliases and the
project's own plugin transforms all work the way they do in the app. To get that, the build boots a throwaway
Vite server that re-runs the project's `vite.config`. Two things follow from that:

- the config is evaluated a second time per build, so a plugin with heavy or one-shot side effects in `config` or
  `buildStart` sees them run twice
- the loader is a serve-mode server, so plugins declaring `apply: "build"`, or branching on `config.command`, take
  their dev path for component modules

`componentLoader: "isolated"` skips all of it and boots a bare loader that only inherits the `resolve` settings.
Faster, but project plugins don't transform component modules. It is also the automatic fallback when there is no
config file on disk. Either way, a module that throws while loading is reported and skipped rather than failing
the build.

#### light-DOM children

Children are kept as they were written, next to the inlined shadow root, so the browser projects them into their
`<slot>`s while parsing and slotted content is styled at first paint too.

```html
<user-card>
	<h2 slot="name">Ada</h2>
</user-card>
```

- children are attached to the host before the component mounts, so a component reading its own light DOM
  (`host.children`, `slot.assignedNodes()`) sees the real thing during the render
- a component in that light DOM is rendered along with its parent, unless `ssr="false"` says otherwise

#### waiting

The render waits for every `pending-task` event a component announces, the
[webcomponents-cg protocol](https://github.com/webcomponents-cg/community-protocols/blob/main/proposals/pending-task.md).
grundlage dispatches one whenever a component waits on a promise before its first paint, nested components
included. A component still waiting after `firstYieldTimeoutMs` is left for the browser, and the rest of the page
ships. `yield* load(…)` results ship inside the declarative shadow root as
`<script type="application/json" data-ssr>`, and hydration consumes them.

#### elements of other libraries

Any web component can prerender, not only grundlage's. One does when:

- its shadow root is open and serializable (`serializable: true`, which most libraries leave off)
- it attaches that root in its constructor; nested in a prerendered root, attaching on connect is enough
- it paints synchronously, or announces a `pending-task` until it has painted
- in the browser, it attaches its root again, which makes the browser replace the server's copy

Adopted style sheets don't reach the output, so that copy shows unstyled until the element's JavaScript loads. Lit
reuses an existing shadow root instead and paints a second copy next to the server's, so Lit elements are best
left with their default root, which isn't serializable and stays out quietly.

There is no `grundlage-render` event for another library's element: under `ssr="false"` it still runs on the
server. Its shadow root is left out, but what it writes into its light DOM ships, and a throw from it leaves its
parent for the browser.

## options

| option                | default            | effect                                                                                   |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `include`             | every page         | page globs, relative to the Vite root, that prerender; `[]` for none                     |
| `exclude`             | —                  | page globs that don't                                                                    |
| `componentLoader`     | `"project-config"` | build only: `"isolated"` loads component modules without re-running the project's config |
| `firstYieldTimeoutMs` | `5000`             | how long the render waits for announced `pending-task`s, nested ones included            |

## fallbacks

Whatever the plugin can't prerender stays as written and paints in the browser. Each case logs a `[prerender]`
warning, and the page still works:

- a tag no module the page imports defines
- a constructor that throws, a closed shadow root (happy-dom can't serialize it), or a root that isn't serializable,
  which warns only when the element carries `ssr` itself
- a component that throws on the server; browser-only work belongs after its first paint, which the server never
  reaches
- a component still waiting after `firstYieldTimeoutMs`, or one that painted nothing and announced no
  `pending-task`
- any other throw during the render
