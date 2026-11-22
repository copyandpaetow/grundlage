import type { ESTree, Plugin, Rule } from "@oxlint/plugins";

const CREATE_PREFIX = /^create[A-Z]/;
//`///` is a reference directive and `@ts-expect-error` or `@vitest-environment` is read by a tool
const DIRECTIVE_PATTERN = /^\/|^\s*@/;
//one space is a habit; two or more indent a line inside a comment block on purpose
const HABIT_SPACE_PATTERN = /^ \S/;

type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;

const nameOf = (node: FunctionNode): string => {
	if (node.id) return node.id.name;
	const { parent } = node;
	if (parent.type === "VariableDeclarator") {
		return parent.id.type === "Identifier" ? parent.id.name : "";
	}
	const isMember = parent.type === "MethodDefinition" || parent.type === "Property";
	if (isMember && parent.key.type === "Identifier") return parent.key.name;
	return "";
};

const isAnnotatedBoolean = (pattern: ESTree.ParamPattern | ESTree.BindingPattern): boolean =>
	pattern.type === "Identifier" &&
	pattern.typeAnnotation?.typeAnnotation.type === "TSBooleanKeyword";

const isBooleanParameter = (parameter: ESTree.ParamPattern): boolean => {
	if (parameter.type !== "AssignmentPattern") return isAnnotatedBoolean(parameter);
	const hasBooleanDefault =
		parameter.right.type === "Literal" && typeof parameter.right.value === "boolean";
	return hasBooleanDefault || isAnnotatedBoolean(parameter.left);
};

const noBooleanParameter: Rule = {
	create: (context) => {
		const check = (node: FunctionNode): void => {
			//a create... function fills a struct, where a boolean field is fine
			if (CREATE_PREFIX.test(nameOf(node))) return;
			for (const parameter of node.params) {
				if (!isBooleanParameter(parameter)) continue;
				context.report({
					node: parameter,
					message:
						"A function expects a named kind, not a boolean parameter. Split the function or take a union of named kinds.",
				});
			}
		};
		return {
			FunctionDeclaration: check,
			FunctionExpression: check,
			ArrowFunctionExpression: check,
		};
	},
};

const commentFormat: Rule = {
	meta: { fixable: "code" },
	create: (context) => ({
		Program: () => {
			for (const comment of context.sourceCode.getAllComments()) {
				const isProse = comment.type === "Line" && !DIRECTIVE_PATTERN.test(comment.value);
				if (!isProse || !HABIT_SPACE_PATTERN.test(comment.value)) continue;
				const spaceStart = comment.start + "//".length;
				context.report({
					loc: comment.loc,
					message: "A comment is written //text, not // text. Remove the space.",
					fix: (fixer) => fixer.removeRange([spaceStart, spaceStart + 1]),
				});
			}
		},
	}),
};

const plugin: Plugin = {
	meta: { name: "guide" },
	rules: {
		"no-boolean-parameter": noBooleanParameter,
		"comment-format": commentFormat,
	},
};

//oxlint loads a plugin from its default export
export default plugin;
