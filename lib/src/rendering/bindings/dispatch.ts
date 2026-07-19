import { BINDING } from "../../parser/constants";
import { composeSheet } from "../../parser/css";
import { StaticBinding } from "../../parser/types";
import { Instance } from "../instance";
import { ATTRIBUTE_MODE, UNSET_HASH } from "../constants";
import { commitAttribute, hydrateAttribute } from "./attribute";
import {
	applyDynamicAttribute,
	commitDynamic,
	reapplyOnSwap as reapplyDynamicOnSwap,
	hydrateDynamic,
} from "./attribute-dynamic";
import {
	commitSingleValue,
	reapplyOnSwap as reapplySingleValueOnSwap,
	revertAttributeMode,
	hydrateOrCommitSingleValue,
} from "./attribute-single-value";
import { commitComment, hydrateComment } from "./comment";
import { commitContent, hydrateContent, UNRESOLVED_CONTENT } from "./content";
import { releaseCssGroups } from "./css-apply";
import { commitRawContent, hydrateRawContent } from "./content-raw";
import {
	commitNamedDynamic,
	reapplyOnSwap as reapplyNamedDynamicOnSwap,
} from "./attribute-named-dynamic";
import { commitTag, hydrateTag } from "./tag";
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

export const hydrateLiveBinding = (
	instance: Instance,
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.TAG:
			return hydrateTag(liveBinding as TagLiveBinding, values);
		case BINDING.ATTRIBUTE:
			return hydrateAttribute(liveBinding as AttributeLiveBinding, values);
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return hydrateOrCommitSingleValue(
				liveBinding as SingleValueAttributeLiveBinding,
				values,
			);
		case BINDING.DYNAMIC_ATTRIBUTE:
			return hydrateDynamic(liveBinding as DynamicAttributeLiveBinding, values);
		case BINDING.NAMED_DYNAMIC:
			return commitLiveBinding(instance, liveBinding, values);
		case BINDING.CONTENT:
			return hydrateContent(
				liveBinding as ContentLiveBinding,
				values,
				instance.carrier,
			);
		case BINDING.RAW_CONTENT:
			return hydrateRawContent(liveBinding as RawContentLiveBinding, values);
		case BINDING.COMMENT:
			return hydrateComment(liveBinding as CommentLiveBinding, values);
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

//paired release for createLiveBinding's host-side acquire (css custom properties on the host)
export const releaseLiveBinding = (
	liveBinding: LiveBinding,
	host: HTMLElement,
): void => {
	if (liveBinding.staticBinding.type !== BINDING.RAW_CONTENT) return;
	const rawContent = liveBinding as RawContentLiveBinding;
	if (rawContent.cssState !== null) releaseCssGroups(rawContent, host);
};
