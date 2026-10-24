import { expectTypeOf, test } from "vitest";
import { component, prop, type PassedPropsOf, type PropsOf } from "../index";
import type { StandardSchemaV1 } from "../types";

type Habit = { id: string };
type CheckIn = { day: string };

const streakHabitProps = {
	habit: prop.property<Habit>(),
	checkIns: prop.property<Array<CheckIn>>([]),
	milestoneAward: prop.optional(prop.property<{ label: string }>()),
	today: prop.attribute(String),
	headingLevel: prop.attribute(Number, 1),
	variant: prop.attribute(prop.oneOf("primary", "secondary"), "primary"),
	isOpen: prop.attribute(Boolean),
	onSelect: prop.property<(id: string) => void>(),
};

test("hoisted schema infers without satisfies", () => {
	component(
		function* ({
			habit,
			checkIns,
			milestoneAward,
			today,
			headingLevel,
			variant,
			isOpen,
			onSelect,
		}) {
			expectTypeOf(habit).toEqualTypeOf<Habit>();
			expectTypeOf(checkIns).toEqualTypeOf<Array<CheckIn>>();
			expectTypeOf(milestoneAward).toEqualTypeOf<
				{ label: string } | undefined
			>();
			expectTypeOf(today).toEqualTypeOf<string>();
			expectTypeOf(headingLevel).toEqualTypeOf<number>();
			expectTypeOf(variant).toEqualTypeOf<"primary" | "secondary">();
			expectTypeOf(isOpen).toEqualTypeOf<boolean>();
			expectTypeOf(onSelect).toEqualTypeOf<(id: string) => void>();
		},
		{ props: streakHabitProps },
	);
});

test("PropsOf and PassedPropsOf", () => {
	type Inside = PropsOf<typeof streakHabitProps>;
	type Passed = PassedPropsOf<typeof streakHabitProps>;
	expectTypeOf<Inside>().toEqualTypeOf<{
		habit: Habit;
		checkIns: Array<CheckIn>;
		milestoneAward?: { label: string };
		today: string;
		headingLevel: number;
		variant: "primary" | "secondary";
		isOpen: boolean;
		onSelect: (id: string) => void;
	}>();
	expectTypeOf<Passed>().toEqualTypeOf<{
		habit: Habit;
		today: string;
		onSelect: (id: string) => void;
		checkIns?: Array<CheckIn>;
		milestoneAward?: { label: string };
		headingLevel?: number;
		variant?: "primary" | "secondary";
		isOpen?: boolean;
	}>();
	const passed: Passed = {
		habit: { id: "a" },
		today: "2026-10-23",
		onSelect: () => {},
	};
	void passed;
});

test("invalid nestings are type errors", () => {
	// @ts-expect-error prop.optional() takes a prop without a fallback
	prop.optional(prop.attribute(Number, 0));
	// @ts-expect-error prop.optional(prop.optional())
	prop.optional(prop.optional(prop.property<string>()));
	// @ts-expect-error fallback must match the parser
	prop.attribute(Number, "zero");
	// @ts-expect-error fallback must match the type
	prop.property<Array<CheckIn>>([{ wrong: 1 }]);
	// @ts-expect-error a oneOf fallback outside the set
	prop.attribute(prop.oneOf("primary", "secondary"), "tertiary");
	// @ts-expect-error optional Boolean has an implicit fallback
	prop.optional(prop.attribute(Boolean));
});

test("element type carries the props", () => {
	const StreakHabit = component(function* () {}, { props: streakHabitProps });
	const element = new StreakHabit();
	expectTypeOf(element.habit).toEqualTypeOf<Habit>();
	expectTypeOf(element.milestoneAward).toEqualTypeOf<
		{ label: string } | undefined
	>();
});

test("positives are not any", () => {
	type Inside = PropsOf<typeof streakHabitProps>;
	type Passed = PassedPropsOf<typeof streakHabitProps>;
	// @ts-expect-error habit is Habit
	const habit: Inside["habit"] = "x";
	// @ts-expect-error variant is a union
	const variant: Inside["variant"] = "tertiary";
	// @ts-expect-error habit is required when passed
	const passed: Passed = { today: "x", onSelect: () => {} };
	component(
		function* ({ habit, today }) {
			// @ts-expect-error habit is not optional in the body
			const id: undefined = habit;
			// @ts-expect-error today is string
			const day: number = today;
			(void id, day);
		},
		{ props: streakHabitProps },
	);
	(void habit, variant, passed);
});

test("a Standard Schema types the prop", () => {
	const HabitSchema = {} as StandardSchemaV1<unknown, Habit>;
	const schema = {
		habit: prop.property(HabitSchema),
		fallbackHabit: prop.property(HabitSchema, { id: "x" }),
		selected: prop.property<Habit | null>(null),
	};
	component(
		function* ({ habit, fallbackHabit, selected }) {
			expectTypeOf(habit).toEqualTypeOf<Habit>();
			expectTypeOf(fallbackHabit).toEqualTypeOf<Habit>();
			expectTypeOf(selected).toEqualTypeOf<Habit | null>();
		},
		{ props: schema },
	);
	// @ts-expect-error fallback must match the schema's output
	prop.property(HabitSchema, { wrong: 1 });
});

test("unreflected wraps an attribute prop only", () => {
	const schema = {
		value: prop.unreflected(prop.attribute(Number, 0)),
		required: prop.unreflected(prop.attribute(String)),
		maybe: prop.optional(prop.unreflected(prop.attribute(String))),
	};
	component(
		function* ({ value, required, maybe }) {
			expectTypeOf(value).toEqualTypeOf<number>();
			expectTypeOf(required).toEqualTypeOf<string>();
			expectTypeOf(maybe).toEqualTypeOf<string | undefined>();
		},
		{ props: schema },
	);
	// @ts-expect-error a property prop never reflects
	prop.unreflected(prop.property<string>());
	// @ts-expect-error optional goes outermost
	prop.unreflected(prop.optional(prop.attribute(String)));
});
