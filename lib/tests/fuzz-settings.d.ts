//vitest.config.ts provides these to every fuzzer, in node and in the browser alike; npm run fuzz
//raises the scale and picks a first seed, and null leaves each fuzzer its own
declare module "vitest" {
	export interface ProvidedContext {
		fuzzScale: number;
		fuzzFirstSeed: number | null;
	}
}

export {};
