# Mutation and Cloning Behavior

## How state is managed

`FluentRegexPipeline` and `FluentAsyncRegexPipeline` store the `initialValue` you pass to the constructor. On every `run()` call, they produce a **deep clone** of that value via `JSON.parse(JSON.stringify(initialValue))` before passing it to the first step. This means:

- The constructor's `initialValue` is never mutated by `run()`.
- Each `run()` call receives its own independent copy of the initial state.
- Reducers may freely mutate the accumulator they receive — those mutations stay within that single `run()` call.

```typescript
const init = { items: [] as string[] };
const pipeline = new FluentRegexPipeline(init)
  .step(/\w+/g, (acc, m) => { acc.items.push(m[0]); return acc; });

const r1 = pipeline.run("hello world");
const r2 = pipeline.run("foo bar");

r1.data.items // ["hello", "world"]
r2.data.items // ["foo", "bar"]
init.items    // [] — untouched
```

## JSON-serialisability constraint

Because cloning is done via `JSON.parse(JSON.stringify(...))`, the `initialValue` **must be JSON-serialisable**. The following types will not survive the round-trip and must not appear in `initialValue`:

| Type | What happens |
|------|-------------|
| `undefined` values in objects | Key is dropped |
| `Date` | Becomes a string |
| `Map` / `Set` | Becomes `{}` |
| `function` | Dropped |
| `RegExp` | Becomes `{}` |
| Circular references | Throws `TypeError` |
| `BigInt` | Throws `TypeError` |

**Stick to plain objects, arrays, strings, numbers, and booleans.**

```typescript
// ✅ Safe
new FluentRegexPipeline({ count: 0, tags: [] as string[], meta: { active: true } });

// ❌ Will not clone correctly
new FluentRegexPipeline({ seen: new Set<string>(), created: new Date() });
```

If your state must include non-serialisable types, maintain the value outside the pipeline and pass a freshly constructed copy to a standalone `regexStep` or `processString` call each time instead of using the fluent builder.

## Pipeline step list is not cloned between `run()` calls

Only the **accumulator** is cloned per run. The registered steps (`_steps`) are shared across all `run()` calls on the same instance. Adding steps between runs is safe — new steps are appended and take effect on the next `run()`.

## `clone()` — copying a pipeline

`clone()` returns a new pipeline instance with the same `initialValue` and a **shallow copy** of the current step list. The `initialValue` reference is shared, but because every `run()` deep-clones it before use, this is safe.

```typescript
const base = new FluentRegexPipeline({ sum: 0 })
  .step(/\d+/g, (acc, m) => { acc.sum += Number(m[0]); return acc; });

const extended = base.clone()
  .step(/[a-z]+/gi, (acc, m) => acc); // extra step only on the copy

base.size();     // 1
extended.size(); // 2
```

Adding steps to `extended` does not affect `base`.

## `reset()` — clearing steps

`reset()` removes all registered steps but keeps the `initialValue` intact. After calling `reset()`, `run()` returns the deep-cloned `initialValue` directly (no steps to execute).

```typescript
pipeline.reset();
const result = pipeline.run("1 2 3");
result.data // deep clone of initialValue, unmodified
```
