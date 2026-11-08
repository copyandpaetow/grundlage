import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import plugin from "./guide-plugin";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const ruleOf = (name: string) => {
	const rule = plugin.rules[name];
	if (!rule) throw new Error(`guide-plugin has no rule "${name}"`);
	return rule;
};

tester.run("cast-reason", ruleOf("cast-reason"), {
	valid: [
		"const modes = ['a', 'b'] as const;",
		"//the walker only stops on comments\nconst comment = walker.currentNode as Comment;",
		"const comment = walker.currentNode as Comment; //the walker only stops on comments",
		"//the map was filled above\nconst row = rows.get(key)!;",
	],
	invalid: [
		{ code: "const comment = walker.currentNode as Comment;", errors: 1 },
		{ code: "const row = rows.get(key)!;", errors: 1 },
		{ code: "const value = input as unknown as number;", errors: 2 },
		{ code: "//a reason two lines up\n\nconst row = rows.get(key)!;", errors: 1 },
	],
});

tester.run("no-boolean-parameter", ruleOf("no-boolean-parameter"), {
	valid: [
		"const paint = (mode: 'replace' | 'append') => {};",
		"const open = ({ isModal }: { isModal: boolean }) => {};",
		"const createRoot = (isHydrationPending: boolean) => ({ isHydrationPending });",
		"function createRoot(isHydrationPending: boolean) { return { isHydrationPending }; }",
		"type Callback = (isOpen: boolean) => void;",
	],
	invalid: [
		{ code: "const paint = (isAppending: boolean) => {};", errors: 1 },
		{ code: "function paint(isAppending = false) {}", errors: 1 },
		{ code: "const paint = (isAppending: boolean = true) => {};", errors: 1 },
		{ code: "class Field { formDisabledCallback(disabled: boolean) {} }", errors: 1 },
	],
});

tester.run("comment-format", ruleOf("comment-format"), {
	valid: [
		"//a reason",
		"//",
		"// @ts-expect-error the value is a string\nconst count: number = '1';",
		"/// <reference types='vite/client' />",
		"//a list:\n//  - indented on purpose",
		"/* a block comment stays as it is */",
	],
	invalid: [
		{ code: "// a reason", output: "//a reason", errors: 1 },
		{ code: "const count = 1; // a reason", output: "const count = 1; //a reason", errors: 1 },
	],
});
