//a generator has one resume type for all of its yields, so a bare `yield promise` evaluates to
//unknown; `yield*` evaluates to the delegate's own return type instead
export function* awaited<Value>(
	promise: Promise<Value>,
): Generator<Promise<Value>, Value, unknown> {
	//the driver resumes a yielded promise with its resolved value
	return (yield promise) as Value;
}
