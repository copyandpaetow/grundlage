export const UNSET_HASH = Number.NaN;

//no attribute name is empty, so a name compared against it never matches
export const NO_ATTRIBUTE_WRITTEN = "";

export const DEFER_HYDRATION_ATTRIBUTE = "defer-hydration";

//every component class carries this static, so it also marks one. Registered, so a component from
//another bundled copy of the library is read the same way
export const DECLARED_PROP_NAMES: unique symbol = Symbol.for(
	"grundlage.declared-prop-names",
);
