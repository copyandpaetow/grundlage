# vite-plugin-grundlage

A Vite plugin that renders [grundlage](https://github.com/copyandpaetow/grundlage) components on the server and
inlines the result into the HTML as declarative shadow DOM. Markup and styles are there when the HTML is first
parsed, and on the client grundlage hydrates that markup instead of rendering it again.

Own package, own version, and a lot younger than the library, so the API can still move between minor versions.
Nothing here is needed to use grundlage itself.

## introduction

### getting started

#### installation

```bash
npm install --save-dev vite-plugin-grundlage
```

- Vite 8 as a peer dependency
- Node 24 or newer, the file scan uses glob patterns that older versions don't take
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
<click-counter start="3" ssr></click-counter>
<!-- prerendered into the page -->
<click-counter start="3"></click-counter>
<!-- left alone, rendered on the client -->
```

### concepts

#### opt in per element

Only the elements carrying the sentinel attribute (`ssr` by default) prerender, in dev and in build. The
attribute stays on the output, so client code can branch on `host.hasAttribute("ssr")`.

#### components are found, not registered

There is no tag-to-module map to maintain. Every source file under the Vite root is imported and the tags those
modules registered are read back from `customElements`, which means module side effects do run at build time.
`node_modules`, `dist`, `build`, declaration files, test/spec/bench files and `*.config.*` are always skipped.

`include` and `exclude` narrow that down, both relative to the Vite root. `include` replaces the default
"everything" pattern, `exclude` is added to the built-in skip list:

```typescript
prerenderWebcomponents({
	include: ["src/components/**/*.ts"],
	exclude: ["**/*.stories.ts"],
});
```

#### the module loader

Component modules are loaded through Vite's own SSR pipeline, so TypeScript, extensionless and directory imports,
aliases and the project's own plugin transforms all work the way they do in the app. To get that, the plugin boots
a throwaway Vite server that re-runs the project's `vite.config`. Two things follow from that:

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
<user-card ssr>
	<h2 slot="name">Ada</h2>
</user-card>
```

- children are attached to the host before the component mounts, so a component reading its own light DOM
  (`host.children`, `slot.assignedNodes()`) sees the real thing during prerender
- a registered component sitting in that light DOM is rendered along with its parent, sentinel or not

## options

| option                | default            | effect                                                                               |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `include`             | every source file  | globs (relative to the Vite root) of the modules to import for component definitions |
| `exclude`             | —                  | globs added to the built-in skip list                                                |
| `componentLoader`     | `"project-config"` | `"isolated"` loads component modules without re-running the project's `vite.config`  |
| `sentinelAttribute`   | `"ssr"`            | the marker attribute that opts an element in                                         |
| `firstYieldTimeoutMs` | `5000`             | how long to wait for the first paint before giving up and leaving it for the client  |

## fallbacks

The plugin degrades to client render whenever it can't serialize an element. Each case logs a `[prerender]`
warning and ships a working page:

- a `{ mode: "closed" }` shadow root, happy-dom can't serialize it
- no shadow content within `firstYieldTimeoutMs`
- a tag no scanned module defines, widen `include` if the module lives elsewhere
- any throw during prerender
