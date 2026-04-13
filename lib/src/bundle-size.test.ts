import {describe, expect, test} from "vitest";
import {readFileSync} from "node:fs";
import {gzipSync} from "node:zlib";
import {resolve} from "node:path";

describe("bundle size", () => {
    const distPath = resolve(import.meta.dirname, "../dist/index.mjs");

    test("raw bundle size stays under 15 KB", () => {
        const raw = readFileSync(distPath);
        const sizeKB = raw.length / 1024;
        expect(sizeKB).toBeLessThan(15);
    });

    test("gzipped bundle size stays under 5 KB", () => {
        const raw = readFileSync(distPath);
        const gzipped = gzipSync(raw, {level: 9});
        const sizeKB = gzipped.length / 1024;
        expect(sizeKB).toBeLessThan(5);
    });
});
