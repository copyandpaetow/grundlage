import { posix } from "node:path";
import { parseAst } from "vite";
import { parseAttributes } from "./scan";

//a module script's own body wires up the page and never runs on the server: only what it
//imports does, which is where the page's components are defined
export interface PageScripts {
	//root-relative urls of `<script type="module" src>`, whose imports vite reports after a transform
	externalScriptUrls: Array<string>;
	//what inline module scripts import, ready to load directly
	inlineScriptImports: Array<string>;
}

export const NO_PAGE_SCRIPTS: PageScripts = {
	externalScriptUrls: [],
	inlineScriptImports: [],
};

const scriptScanPattern =
	/<!--[\s\S]*?-->|<script(?=[\s/>])((?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/script\s*>/g;

const isExternalUrl = (url: string): boolean =>
	/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");

const resolveAgainstPage = (url: string, pageUrlPath: string): string =>
	url.startsWith("/") ? url : posix.join(posix.dirname(pageUrlPath), url);

//in a script, unlike in a `src`, a specifier without a leading `.` or `/` names a package
const isPathSpecifier = (specifier: string): boolean =>
	specifier.startsWith("./") ||
	specifier.startsWith("../") ||
	specifier.startsWith("/");

const staticImportsOf = (code: string): Array<string> => {
	const specifiers: Array<string> = [];
	for (const statement of parseAst(code).body) {
		const isStaticImport =
			statement.type === "ImportDeclaration" ||
			statement.type === "ExportAllDeclaration" ||
			statement.type === "ExportNamedDeclaration";
		if (isStaticImport && statement.source !== null)
			specifiers.push(statement.source.value);
	}
	return specifiers;
};

export const findPageScripts = (
	html: string,
	pageUrlPath: string,
): PageScripts => {
	const pageScripts: PageScripts = {
		externalScriptUrls: [],
		inlineScriptImports: [],
	};
	for (const match of html.matchAll(scriptScanPattern)) {
		const [, rawAttributes, inlineCode = ""] = match;
		if (rawAttributes === undefined) continue;
		const attributes = new Map(
			parseAttributes(rawAttributes).map(([name, value]) => [
				name.toLowerCase(),
				value,
			]),
		);
		if (attributes.get("type")?.toLowerCase() !== "module") continue;

		const source = attributes.get("src");
		if (source !== undefined) {
			if (!isExternalUrl(source))
				pageScripts.externalScriptUrls.push(
					resolveAgainstPage(source, pageUrlPath),
				);
			continue;
		}
		for (const specifier of staticImportsOf(inlineCode)) {
			if (isExternalUrl(specifier)) continue;
			pageScripts.inlineScriptImports.push(
				isPathSpecifier(specifier)
					? resolveAgainstPage(specifier, pageUrlPath)
					: specifier,
			);
		}
	}
	return pageScripts;
};
