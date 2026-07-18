import { BINDING } from "../../parser/constants";
import { composeSheet } from "../../parser/css";
import { StaticBinding } from "../../parser/types";
import { Instance } from "../instance";
import { composeParts } from "../compose";
import { ATTRIBUTE_MODE, UNSET_HASH } from "../constants";
import { attributeGateHash, commitAttribute } from "./attribute";
import {
	applyDynamicAttribute,
	commitDynamic,
	reapplyOnSwap as reapplyDynamicOnSwap,
	seedDynamic,
} from "./attribute-dynamic";
import {
	commitSingleValue,
	reapplyOnSwap as reapplySingleValueOnSwap,
	revertAttributeMode,
	seedOrCommitSingleValue,
} from "./attribute-single-value";
import { commentGateHash, commitComment } from "./comment";
import {
	commitContent,
	seedContentByAdoption,
	UNRESOLVED_CONTENT,
} from "./content";
import { commitRawContent, rawContentGateHash } from "./content-raw";
import { seedCssGroupHashes } from "./css-apply";
import {
	commitNamedDynamic,
	reapplyOnSwap as reapplyNamedDynamicOnSwap,
} from "./named-dynamic";
import { commitTag, tagGateHash } from "./tag";
import {
	AttributeLiveBinding,
	Carrier,
	CommentLiveBinding,
	ContentLiveBinding,
	DynamicAttributeLiveBinding,
	NamedDynamicLiveBinding,
	LiveBinding,
	RawContentLiveBinding,
	RawCssState,
	SingleValueAttributeLiveBinding,
	TagLiveBinding,
} from "./types";

export const createLiveBinding = (
	staticBinding: StaticBinding,
	anchor: Comment | Element | null,
	endMarker: Comment | null = null,
	carrier: Carrier | null = null,
): LiveBinding => {
	switch (staticBinding.type) {
		case BINDING.TAG:
			return {
				staticBinding,
				markerComment: anchor as Comment,
				lastValueHash: UNSET_HASH,
			};
		case BINDING.ATTRIBUTE:
			return {
				staticBinding,
				anchor: anchor!,
				lastValueHash: UNSET_HASH,
				lastComposedName: "",
			};
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return {
				staticBinding,
				anchor: anchor!,
				lastValueHash: UNSET_HASH,
				lastComposedName: "",
				appliedMode: ATTRIBUTE_MODE.ABSENT,
			};
		case BINDING.DYNAMIC_ATTRIBUTE:
			return {
				staticBinding,
				anchor: anchor!,
				appliedAttributes: new Map(),
				lastValueHash: UNSET_HASH,
			};
		case BINDING.NAMED_DYNAMIC:
			return {
				staticBinding,
				anchor: anchor!,
				lastValueHash: UNSET_HASH,
				lastValue: undefined,
			};
		case BINDING.CONTENT:
			return {
				staticBinding,
				startMarker: anchor as Comment,
				endMarker: endMarker!,
				content: UNRESOLVED_CONTENT,
			};
		case BINDING.RAW_CONTENT: {
			//null cssState marks the fallback path: no plan, or the carrier's root
			//template binds the host style attribute and would wipe the host props
			const cssPlan = carrier!.hostStyleIsBound ? null : staticBinding.cssPlan;
			let cssState: RawCssState | null = null;
			if (cssPlan !== null) {
				const mountCounts = (carrier!.cssPlanMountCounts ??= new Map());
				const instanceOrdinal = mountCounts.get(cssPlan) ?? 0;
				mountCounts.set(cssPlan, instanceOrdinal + 1);
				let groupNames: Array<string>;
				let sheetOverride: string | null = null;
				if (instanceOrdinal === 0) {
					groupNames = cssPlan.groupNames;
				} else {
					//the baked base names are already taken on this host — this instance
					//gets suffixed names and rewrites its own sheet once at first commit
					const instancePrefix = `${cssPlan.namePrefix}${instanceOrdinal}-`;
					groupNames = cssPlan.groups.map(
						(group) => instancePrefix + group.ordinal,
					);
					sheetOverride = composeSheet(cssPlan, groupNames);
				}
				cssState = {
					previousGroupHashes: new Array<number>(cssPlan.groups.length).fill(
						UNSET_HASH,
					),
					groupNames,
					sheetOverride,
				};
			}
			return {
				staticBinding,
				markerComment: anchor as Comment,
				lastValueHash: UNSET_HASH,
				cssState,
			};
		}
		case BINDING.COMMENT:
			return {
				staticBinding,
				markerComment: anchor as Comment,
				lastValueHash: UNSET_HASH,
			};
	}
};

export const commitLiveBinding = (
	instance: Instance,
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.TAG:
			return commitTag(
				liveBinding as TagLiveBinding,
				values,
				instance.liveBindings,
			);
		case BINDING.ATTRIBUTE:
			return commitAttribute(liveBinding as AttributeLiveBinding, values);
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return commitSingleValue(
				liveBinding as SingleValueAttributeLiveBinding,
				values,
			);
		case BINDING.DYNAMIC_ATTRIBUTE:
			return commitDynamic(liveBinding as DynamicAttributeLiveBinding, values);
		case BINDING.NAMED_DYNAMIC:
			return commitNamedDynamic(liveBinding as NamedDynamicLiveBinding, values);
		case BINDING.CONTENT:
			return commitContent(
				liveBinding as ContentLiveBinding,
				values,
				instance.carrier,
			);
		case BINDING.RAW_CONTENT:
			return commitRawContent(
				liveBinding as RawContentLiveBinding,
				values,
				instance.carrier.host,
			);
		case BINDING.COMMENT:
			return commitComment(liveBinding as CommentLiveBinding, values);
	}
};

export const seedLiveBinding = (
	instance: Instance,
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.NAMED_DYNAMIC:
			return commitLiveBinding(instance, liveBinding, values);
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return seedOrCommitSingleValue(
				liveBinding as SingleValueAttributeLiveBinding,
				values,
			);
		case BINDING.DYNAMIC_ATTRIBUTE:
			return seedDynamic(liveBinding as DynamicAttributeLiveBinding, values);
		case BINDING.CONTENT:
			return seedContentByAdoption(
				liveBinding as ContentLiveBinding,
				values,
				instance.carrier,
			);
		case BINDING.ATTRIBUTE: {
			const attribute = liveBinding as AttributeLiveBinding;
			attribute.lastComposedName = composeParts(
				attribute.staticBinding.nameParts,
				values,
			);
			attribute.lastValueHash = attributeGateHash(attribute.staticBinding, values);
			return;
		}
		case BINDING.RAW_CONTENT: {
			const rawContent = liveBinding as RawContentLiveBinding;
			if (rawContent.cssState === null) {
				rawContent.lastValueHash = rawContentGateHash(
					rawContent.staticBinding,
					values,
				);
				return;
			}
			//the server already wrote this instance's sheet — suffixed or not
			rawContent.cssState.sheetOverride = null;
			return seedCssGroupHashes(rawContent, values);
		}
		case BINDING.TAG: {
			const tag = liveBinding as TagLiveBinding;
			tag.lastValueHash = tagGateHash(tag.staticBinding, values);
			return;
		}
		case BINDING.COMMENT: {
			const comment = liveBinding as CommentLiveBinding;
			comment.lastValueHash = commentGateHash(comment.staticBinding, values);
			return;
		}
	}
};

export const reapplyOnSwap = (
	liveBinding:
		| SingleValueAttributeLiveBinding
		| DynamicAttributeLiveBinding
		| NamedDynamicLiveBinding,
	element: Element,
	values: Array<unknown>,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return reapplySingleValueOnSwap(
				liveBinding as SingleValueAttributeLiveBinding,
				element,
				values,
			);
		case BINDING.DYNAMIC_ATTRIBUTE:
			return reapplyDynamicOnSwap(
				liveBinding as DynamicAttributeLiveBinding,
				element,
				values,
			);
		default:
			return reapplyNamedDynamicOnSwap(
				liveBinding as NamedDynamicLiveBinding,
				element,
			);
	}
};

export const revertHostBinding = (liveBinding: LiveBinding): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.ATTRIBUTE: {
			const attribute = liveBinding as AttributeLiveBinding;
			const { anchor } = attribute;
			if (anchor instanceof Element && attribute.lastComposedName !== "")
				anchor.removeAttribute(attribute.lastComposedName);
			return;
		}
		case BINDING.SINGLE_VALUE_ATTRIBUTE: {
			const single = liveBinding as SingleValueAttributeLiveBinding;
			if (single.anchor instanceof Element)
				revertAttributeMode(single.anchor, single);
			return;
		}
		case BINDING.DYNAMIC_ATTRIBUTE: {
			const dynamic = liveBinding as DynamicAttributeLiveBinding;
			const { anchor } = dynamic;
			if (!(anchor instanceof Element)) return;
			for (const [name, entry] of dynamic.appliedAttributes)
				applyDynamicAttribute(anchor, name, null, entry.value);
			return;
		}
		case BINDING.NAMED_DYNAMIC: {
			const named = liveBinding as NamedDynamicLiveBinding;
			if (named.anchor instanceof Element)
				applyDynamicAttribute(
					named.anchor,
					named.staticBinding.name,
					null,
					named.lastValue,
				);
			return;
		}
	}
};
