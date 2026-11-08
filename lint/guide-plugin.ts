import type { ESTree, Plugin, Rule } from "@oxlint/plugins";

const CREATE_PREFIX = /^create[A-Z]/;
//`///` is a reference directive and `@ts-expect-error` or `@vitest-environment` is read by a tool
const DIRECTIVE_PATTERN = /^\/|^\s*@/;
//one space is a habit; two or more indent a line inside a comment block on purpose
const HABIT_SPACE_PATTERN = /^ \S/;

type CastNode = ESTree.TSAsExpression | ESTree.TSTypeAssertion | ESTree.TSNonNullExpression;
type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;

const isConstAssertion = (node: CastNode): boolean =>
	node.type !== "TSNonNullExpression" &&
	node.typeAnnotation.type === "TSTypeReference" &&
	node.typeAnnotation.typeName.type === "Identifier" &&
	node.typeAnnotation.typeName.name === "const";

const castReason: Rule = {
	create: (context) => {
		const linesWithReason = new Set<number>();
		for (const comment of context.sourceCode.getAllComments()) {
			for (let line = comment.loc.start.line; line <= comment.loc.end.line + 1; line++) {
				linesWithReason.add(line);
			}
		}
		const check = (node: CastNode): void => {
			if (isConstAssertion(node) || linesWithReason.has(node.loc.start.line)) return;
			context.report({
				node,
				message:
					"A cast needs its reason in a comment on its line or the line above. Try an asserts helper or a narrowing guard first.",
			});
		};
		return { TSAsExpression: check, TSTypeAssertion: check, TSNonNullExpression: check };
	},
};

const nameOf = (node: FunctionNode): string => {
	if (node.id) return node.id.name;
	const { parent } = node;
	const isNamedVariable = parent.type === "VariableDeclarator" && parent.id.type === "Identifier";
	if (isNamedVariable) return parent.id.name;
	const isNamedMember =
		(parent.type === "MethodDefinition" || parent.type === "Property") &&
		parent.key.type === "Identifier";
	return isNamedMember ? parent.key.name : "";
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
			//a create… function fills a struct, where a boolean field is fine
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
		"cast-reason": castReason,
		"no-boolean-parameter": noBooleanParameter,
		"comment-format": commentFormat,
	},
};

//oxlint loads a plugin from its default export
export default plugin;
