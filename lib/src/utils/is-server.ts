//single source of truth for the server-vs-client branch
//two signals; either flips the lib into server mode:
//- `typeof window === "undefined"` — node/SSR. The prerender plugin polyfills `document` etc. onto `globalThis` but deliberately never assigns `window`
//- `globalThis.__grundlage_ssr__ === true` — explicit opt-in for environments that DO have `window` but want server semantics (in-browser SSR tests that exercise the serialization+hydration round-trip in a real browser)
//read at each call site (not cached) so tests can toggle their environment between calls without state leaking
export const isServer = (): boolean =>
	typeof window === "undefined" ||
	(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ === true;
