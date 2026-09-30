import { CHAR_CODE } from "./chars";
import { Part } from "./types";
import { assertDuringDevelopment, libraryMessage } from "../utils/diagnostics";

const NEEDS_DECODING_PATTERN = /[\r\0&]/;
const CHARACTER_REFERENCE_PATTERN =
	/&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g;

const NAMED_REFERENCES: ReadonlyMap<string, string> = new Map([
	["amp", "&"],
	["AMP", "&"],
	["lt", "<"],
	["LT", "<"],
	["gt", ">"],
	["GT", ">"],
	["quot", '"'],
	["QUOT", '"'],
	["apos", "'"],
	["nbsp", " "],
]);

const REPLACEMENT_CHARACTER = "�";
const LAST_CODE_POINT = 0x10ffff;

//the HTML parser reads 0x80 to 0x9F as windows-1252; the five codes missing here stay as they are
const WINDOWS_1252_REMAP: ReadonlyMap<number, number> = new Map([
	[0x80, 0x20ac],
	[0x82, 0x201a],
	[0x83, 0x0192],
	[0x84, 0x201e],
	[0x85, 0x2026],
	[0x86, 0x2020],
	[0x87, 0x2021],
	[0x88, 0x02c6],
	[0x89, 0x2030],
	[0x8a, 0x0160],
	[0x8b, 0x2039],
	[0x8c, 0x0152],
	[0x8e, 0x017d],
	[0x91, 0x2018],
	[0x92, 0x2019],
	[0x93, 0x201c],
	[0x94, 0x201d],
	[0x95, 0x2022],
	[0x96, 0x2013],
	[0x97, 0x2014],
	[0x98, 0x02dc],
	[0x99, 0x2122],
	[0x9a, 0x0161],
	[0x9b, 0x203a],
	[0x9c, 0x0153],
	[0x9e, 0x017e],
	[0x9f, 0x0178],
]);

const decodeNumericReference = (codePoint: number): string => {
	const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
	if (codePoint === 0 || codePoint > LAST_CODE_POINT || isSurrogate)
		return REPLACEMENT_CHARACTER;
	return String.fromCodePoint(WINDOWS_1252_REMAP.get(codePoint) ?? codePoint);
};

const decodeCharacterReference = (
	reference: string,
	hexadecimalDigits: string | undefined,
	decimalDigits: string | undefined,
	name: string | undefined,
	semicolon: string,
): string => {
	if (hexadecimalDigits !== undefined)
		return decodeNumericReference(parseInt(hexadecimalDigits, 16));
	if (decimalDigits !== undefined)
		return decodeNumericReference(parseInt(decimalDigits, 10));
	assertDuringDevelopment(
		name !== undefined,
		"a character reference without digits matched the name alternative",
	);
	const decoded = NAMED_REFERENCES.get(name);
	//`&apos` has no legacy form, and the pattern already consumed every letter and digit after a name
	const isLegacyFormWithoutSemicolon = semicolon === "" && name !== "apos";
	if (
		decoded !== undefined &&
		(semicolon === ";" || isLegacyFormWithoutSemicolon)
	)
		return decoded;
	throw new Error(
		libraryMessage(
			`"${reference}" in a <textarea> that has a \${…} is not decoded. Write the character itself, or "&amp;" for a literal "&".`,
		),
	);
};

const decodeRCDATAText = (text: string): string => {
	if (!NEEDS_DECODING_PATTERN.test(text)) return text;
	return text
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.replaceAll("\0", REPLACEMENT_CHARACTER)
		.replace(CHARACTER_REFERENCE_PATTERN, decodeCharacterReference);
};

//static parts beside a hole are written as text, so the decoding the browser parser does for
//textarea content happens here, once per template
export const decodeTextareaParts = (parts: Array<Part>): void => {
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (typeof part === "string") parts[index] = decodeRCDATAText(part);
	}
	const firstPart = parts[0];
	if (
		typeof firstPart === "string" &&
		firstPart.charCodeAt(0) === CHAR_CODE.LINE_FEED
	)
		parts[0] = firstPart.slice(1);
};
