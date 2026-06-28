export const isServer = (): boolean =>
	typeof window === "undefined" ||
	(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ === true;
