import { libraryMessage } from "../../utils/diagnostics";

//the HTML serializer writes <style> and <script> text and comment data unescaped, so text that
//closes them early ends them in server markup and what follows parses as HTML

const STYLE_BREAKOUT_PATTERN = /<\/style/i;
//after `<!--` a `<script` makes the parser skip the `</script>` that should close the element
const SCRIPT_BREAKOUT_PATTERN = /<\/script|<!--/i;
//`<!-->` and `<!--->` are whole comments, and `--!>` closes one like `-->`
const COMMENT_BREAKOUT_PATTERN = /^-?>|--!?>/;

const EXCERPT_LENGTH = 40;

const excerptAt = (text: string, index: number) =>
	JSON.stringify(text.slice(index, index + EXCERPT_LENGTH));

export const ensureStyleText = (text: string): void => {
	const index = text.search(STYLE_BREAKOUT_PATTERN);
	if (index === -1) return;
	throw new Error(
		libraryMessage(
			`<style> expects CSS without "</style", which ends the element early in server markup, not ${excerptAt(text, index)}. Write the "<" in a CSS string as "\\3c ".`,
		),
	);
};

export const ensureScriptText = (text: string): void => {
	const index = text.search(SCRIPT_BREAKOUT_PATTERN);
	if (index === -1) return;
	throw new Error(
		libraryMessage(
			`<script> expects text without "</script" or "<!--", which can end the element early in server markup, not ${excerptAt(text, index)}. Write each "<" as "\\u003c", which JSON and JavaScript strings read as "<".`,
		),
	);
};

export const ensureCommentText = (text: string): void => {
	const index = text.search(COMMENT_BREAKOUT_PATTERN);
	if (index === -1) return;
	throw new Error(
		libraryMessage(
			`a comment expects text without "-->" or "--!>" and without a leading ">" or "->", which end it early in server markup, not ${excerptAt(text, index)}. Leave them out of the value.`,
		),
	);
};
