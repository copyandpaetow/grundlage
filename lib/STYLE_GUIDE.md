# Style guide

How code in this library is written. Defaults, not dogma: a deviation carries a why-comment, and a
performance deviation carries a measurement.

## Priorities

Read top to bottom. A lower rule never overrides a higher one.

1. **Correctness gates everything.** A wrong render or a silently missed change is broken at any
   speed.
2. **Simplicity and consistency are the fabric.** Without a proven reason to deviate, this guide is
   what the code is.
3. **Performance is a measured veto.** Only two things count: DOM writes and per-frame allocations.
   An override is shown by a measurement, never argued from theory or a micro-benchmark.

### What performance is

- **DOM writes are most of the frame.** The most important code is the change-detection skip path:
  an unchanged value touches the DOM not at all, so focus, scroll, transitions, listeners and
  nested state survive. A false write (re-setting an unchanged value) is the worst performance bug.
  Patch over rebuild, move over recreate.
- **Change detection notices in-place mutation.** A value mutated in place (same reference, new
  contents) is a change. Equality never reports "unchanged" for something that changed. A hash is
  treated as collision-free.
- **Allocation causes GC pauses.** Allocate at setup, not per frame. Never keep a render's
  transient values past the frame that produced them.
- **Everything else is the JIT's job**: hidden classes, monomorphic shapes, memory layout, loop
  style. Write the clearest version.

### Measuring

- Real browser, high volume. Scale the workload (rows, components, updates) until the machine
  struggles; where performance breaks, and what breaks first, is the measurement. No
  micro-benchmark stands in.
- Three numbers per operation: DOM mutation count, wall-clock time including paint, and
  memory/GC.
- A change earns its override when it improves one number without regressing the others.

## Data and state

1. **Data and behavior are separate.** State is a plain struct built by a `create…` function, typed
   by an `interface`, and changed by free functions that take it first. Data holds no functions.
   _Exception:_ the platform demands a class (a custom element).
2. **Description data is readonly, live data is mutable.** Description data is built once and
   shared (a parsed template, a normalized schema). Its types are `readonly`, and nothing freezes
   it at runtime. Live data (per-element render state, per-binding state, reused buffers) is written
   in place.
3. **The parent writes.** A leaf computes and returns; it never assigns a field. A helper that
   would have to hand back several values is inlined into its parent, into more than one parent if
   needed. Calling another module's writer is a parent calling a parent. _Exempt:_ buffer contents
   (`fill`, index writes) and DOM writes.
4. **State is where data sits or which variant it is.** Membership in a collection (being in the
   queue is being queued) or a tagged union. Fields that constrain each other become one union or
   one membership. A boolean stays only when it is independent of every other field.
5. **Derive, don't store.** A fact another field or the platform already holds is read, not copied
   (`isConnected`).
6. **Module scope holds only what is process-wide**: a singleton, itself a struct from its own
   `create…`; a cache keyed by identity; a lazy memo or its counter. Each carries a comment on why
   it outlives a frame. Nothing per element.
7. **Never mutate caller-owned data.** An array or object passed into the public API stays as it
   was passed.
8. **Reused buffers are cleared or bounded before they are read.** Stale data from a previous use
   is a bug.

### Unions and absence

- The discriminant sits at the top level of every union member. TypeScript does not narrow through
  `value.inner.kind`, so a nested discriminant makes every switch pay a cast.
- A field means the same thing in every variant of a union.
- Our types are told apart by an `isX(value)` guard, never `instanceof`. Platform types use
  `instanceof` or `typeof`. _Exception:_ duck-typing a user-supplied object, commented as user
  surface.
- Sentinels over `undefined` as a signal. Each kind of absence is declared once. `null` means "will
  hold a real value". An optional parameter's own absence and a `Map.get` miss are honest
  `undefined`. Where the platform forces one channel to carry two meanings, the declaration names
  both in a comment.
- Enums are `as const` objects read through a type named after the constant plus `Kind`:
  `type ParseModeKind = ValueOf<typeof PARSE_MODE>`. Values are numbers. Enums that
  meet get disjoint ranges, so one value cannot pass for another; an enum that indexes an array
  starts at 0.
- A variant without data is one shared constant, so switching to it allocates nothing.

## Functions and control flow

1. **Push ifs up, fors down.** The parent holds the branching and the state; leaves are pure when
   their result is a value.
2. **Inverse hourglass.** Few parameters, a simple return type, a meaty body.
3. **Command-query separation.** A function changes state or answers a question, never both. The
   exceptions are test-and-set, spelled `claim…`, and a memoized read whose cache no caller can
   observe.
4. **A minimum of abstractions.** Every one leaks; add one only where it names the domain best. A
   forwarding function (`a(x) { return b(x) }`) is worse than the duplication it removes.
5. **One entry point per state machine.** Every transition passes through it, and its assertions
   live there.
6. **Queue outside events and process them at your own pace.** _Exception:_ where platform ordering
   needs synchronous work (a custom element mounts in `connectedCallback`).
7. **Every loop and queue has a bound**, as a named constant or a stated reason it ends. Recursion
   only when its depth is bounded by a named constant or by nesting the user wrote in source.
8. **70 lines is a signal, not a limit.** A parent past it is fine when it reads top to bottom;
   split it when it holds two jobs. A class body is exempt, its methods are not.

### Shape

- Early returns over `else` ladders. Hard-to-follow nesting is the signal to simplify, not to
  comment.
- A `switch` over a closed union ends in `default: return value satisfies never`.
- An `if` with one statement has no braces; anything longer has braces.
- A `void` function never returns a call: an early exit is `endRun(run); return;`, and the last
  statement is the call itself, with no `return` after it.
- Loops: an indexed `for` over arrays, `for…of` over `Set` and `Map`, no `forEach`.
- Name compound conditions as `const`s: naming, not abstraction, no function hop.
- No boolean parameters. Split the function or take a named kind.
- An options object when two arguments can be swapped by mistake, outside hot paths only. A
  `start, end` pair is exempt.
- A return type is annotated where inference is not obvious: exported functions and unions with a
  sentinel.

## Errors and assertions

- **Parse, don't validate.** User input is checked once, at the public boundary, by an
  `ensure…` function, and a bad input throws an error with a remedy. Past the boundary, internal
  state is trusted and checked only by `assert…` assertions. The two never mix.
- **Define errors out of existence** where the API shape allows it: absence of a prop is a write of
  its fallback, so no prop read fails.
- **Every error message names the fix.** "A block body needs an explicit return", not "unexpected
  undefined". Messages go through one helper that adds the library prefix.
- **Errors travel one channel.** An error inside a render goes to the nearest generator that can
  catch it at its `yield`; one that no generator can take ends the component through the one fatal
  path, which dispatches the public error event. `try`/`catch` only at the boundaries that feed it.
  A deliberate swallow is `catch { /* why */ }`. An exception from user cleanup code goes to
  `reportError`.
- **Warnings exist only in the development build.**
- **A platform primitive over an own mechanism** (`Event`, `reportError`, `Promise.withResolvers`).
  An own mechanism needs a reason.

### Assertions

- One development-only helper with an `asserts condition` signature.
- Assert preconditions, postconditions and invariants, including what must not happen. A comment
  that states an invariant becomes an assertion.
- Assertions are not guarded, so `asserts` narrows the type and replaces casts and `!`. The
  production build drops the helper and its message but keeps the condition; a condition that shows
  up in a measurement moves behind the development-build check.
- A failed assertion throws a dedicated invariant error that no library `catch` handles: it is never
  routed into a generator or the fatal path, and surfaces uncaught with its stack. A user's
  `try`/`catch` cannot swallow a library bug, and no cleanup runs on broken state.

## Naming

- **Get the nouns and verbs right.** A generic `[verb][noun]` (`processNode`, `handleValue`) names
  the mechanism, not the intent. Prefer nouns over participles (`pipeline` over `preparing`).
- **No abbreviations.** `text`, not `str`. A long descriptive name beats jargon, but articles carry
  nothing: `generatorMayResumeAfterPaint`, not `theGeneratorMayResumeAfterThisPaint`.
- **One word, one meaning.** Same functionality, same name. Parallel layers (client and server)
  share a role name; different roles never collide. "slot" means `<slot>` and nothing else.
- **Booleans are predicates**: `isReady`, `hasMounted`.
- **Qualifiers go last**, so related names sort together: `HASH_DEPTH_LIMIT`, not `MAX_DEPTH`.
- **`index`, `count` and `size` are distinct**, even though all are `number`. The name says which.
- **Acronyms in platform style**: capitals inside a name (`innerHTML`, `unclaimedSSRPayloads`),
  lowercase at the start (`htmlFor`, `ssrPayload`).
- **Writing is in the name.** A function named as a question or a computation (`is…`, `…Of`,
  `find…`, `classify…`) never writes.

### Verbs on the write path

| verb      | the function                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `mount…`  | creates the nodes for something that does not exist yet                                                                     |
| `patch…`  | reuses the nodes of an existing thing of the same shape; the alternative to `mount`                                         |
| `commit…` | takes the render's values and owns the change gate (one hash, or one per key or index), or routes them to functions that do |
| `apply…`  | performs the platform write, with no gate and no decision whether it is needed                                              |

## Modules and types

- **Imports point one way**, from the entry point down to the utilities. No cycles.
- **Deep modules.** A small exported interface over a lot of behavior.
- **`interface` for structs, `type` for unions.** A file of shared union types stays shared.
- **Every cast needs a reason.** An assertion or a guard that narrows comes first; a remaining
  `as` carries a comment.
- **One marker-walk primitive per DOM protocol.** A marker protocol is defined once and reused by
  every site, so stop conditions cannot drift.

## Comments

- Names carry the meaning. A comment is rare, and it names a present-tense constraint the code
  cannot show.
- At most two lines, written as `//text`, with no space after the slashes.
- No archaeology ("was 97% slower" belongs in the changelog). No commented-out or dead code.

## Tests

- **A test written for an uncovered branch is mutation-checked.** Delete the guard it covers and
  watch that test fail. A test that passes either way pins nothing.
- **Test what must not happen.** Every change gate has a test that an unchanged value causes no
  DOM write.
- **Hashing and matching code gets seeded random inputs.** Sequential values never collide.

## Checks

The rules a grep can check, run from the source directory:

| rule                         | check                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| no `forEach`                 | `grep -rn "\.forEach(" .` finds nothing outside tests       |
| `void` calls do not `return` | review each `return name(` inside a function typed `: void` |
| exhaustive switches          | every `switch` over a union ends in `satisfies never`       |
| casts carry a reason         | every `as` and `!` outside tests has a comment or goes away |
| no import cycles             | no module imports one that imports it back                  |
| "slot" only for `<slot>`     | `grep -rni "slot" .` names only `<slot>` outside tests      |
| comment format               | `grep -rn "^\s*// " .` finds nothing                        |
