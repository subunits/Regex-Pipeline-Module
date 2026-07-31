# `run()` Behavior

Applies to `FluentRegexPipeline` and `FluentAsyncRegexPipeline`.

## What `run()` does

`run(str, options?)` executes all registered steps in the order they were added via `.step()`, threading the accumulator from one step to the next. It returns a `PipelineResult<T>` containing the final accumulated `data`, a `success` flag, `executionTime` in milliseconds, and a `matchCount`.

```typescript
const result = pipeline.run("12 cats 7 dogs");

result.data          // final accumulator value
result.success       // true if no step threw
result.executionTime // wall-clock ms
result.matchCount    // number of steps that completed
```

## Fresh state on every call

Each call to `run()` starts from a **deep clone** of the `initialValue` passed to the constructor. Successive calls are fully independent — they do not accumulate across invocations.

```typescript
const pipeline = new FluentRegexPipeline({ sum: 0 })
  .step(/\d+/g, (acc, m) => { acc.sum += Number(m[0]); return acc; });

const r1 = pipeline.run("1 2 3");   // r1.data.sum === 6
const r2 = pipeline.run("10 20");   // r2.data.sum === 30  (not 36)
```

`r1` and `r2` are separate objects. Mutating one does not affect the other, and neither affects the pipeline's internal `initialValue`.

## Options

```typescript
pipeline.run(str, {
  throwOnError: false, // return result.error instead of throwing (default: true)
  debug: true,         // log each step's output to console.debug
});
```

`FluentAsyncRegexPipeline.run()` additionally accepts:

```typescript
await pipeline.run(str, {
  timeout: 5000, // reject with TIMEOUT_ERROR if any step exceeds 5 s
});
```

## Error handling

With the default `throwOnError: true`, any step error propagates as a thrown `PipelineError`.

With `throwOnError: false`, the error is captured in `result.error` and `result.success` is `false`. The `data` field contains the accumulator state at the point of failure.

```typescript
const result = pipeline.run(input, { throwOnError: false });
if (!result.success) {
  console.error(result.error?.message);
}
```

## Step count vs match count

`matchCount` reflects the number of **steps that completed**, not the number of regex matches within those steps. A pipeline with three steps that all finish successfully will return `matchCount: 3` regardless of how many tokens each step matched.
