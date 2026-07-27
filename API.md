# Regex Pipeline Module - API Reference

Complete API documentation for the Regex Pipeline Module.

## Table of Contents

- [Core Functions](#core-functions)
- [Fluent API](#fluent-api)
- [Utility Functions](#utility-functions)
- [Types](#types)
- [Error Handling](#error-handling)

---

## Core Functions

### `regexStep<T, G>(regex, reducer)`

Creates a synchronous regex processing step.

**Type Parameters:**
- `T` - Accumulator type (state passed through pipeline)
- `G` - Named capture groups type (extends `Record<string, string>`)

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `regex` | `RegExp` | Regular expression with `/g` flag |
| `reducer` | `RegexReducer<T, G>` | Function to process each match |

**Returns:** `RegexStep<T>` - A function that processes a string

**Throws:** `PipelineError`
- Code: `REGEX_INVALID_FLAGS` - Regex missing `/g` flag
- Code: `REDUCER_ERROR` - Error in reducer function

**Example:**

```typescript
const step = regexStep(
  /(\d+)/g,
  (acc, match, index, allMatches, str) => {
    acc.numbers.push(Number(match[0]));
    return acc;
  }
);

const result = step("1 2 3", { numbers: [] });
// { numbers: [1, 2, 3] }
```

**Named Capture Groups:**

```typescript
type DateGroups = { year: string; month: string; day: string };

const step = regexStep<Record<string, string>, DateGroups>(
  /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/g,
  (acc, match) => {
    if (match.groups) {
      acc[`${match.groups.year}-${match.groups.month}`] = match.groups.day;
    }
    return acc;
  }
);
```

---

### `asyncRegexStep<T, G>(regex, reducer)`

Creates an asynchronous regex processing step.

**Type Parameters:**
- `T` - Accumulator type
- `G` - Named capture groups type

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `regex` | `RegExp` | Regular expression with `/g` flag |
| `reducer` | `AsyncRegexReducer<T, G>` | Async function to process each match |

**Returns:** `AsyncRegexStep<T>` - An async function that processes a string

**Throws:** `PipelineError`

**Example:**

```typescript
const step = asyncRegexStep(
  /\w+/g,
  async (acc, match) => {
    const data = await fetchData(match[0]);
    acc.results.push(data);
    return acc;
  }
);

const result = await step("word1 word2", { results: [] });
```

---

### `composeRegexPipelines<T>(...steps)`

Composes multiple sync regex steps into a single pipeline.

**Type Parameters:**
- `T` - Accumulator type

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `steps` | `RegexStep<T>[]` | Variable number of regex steps |

**Returns:** `(str: string, initialValue: T, options?: PipelineOptions) => PipelineResult<T>`

**Example:**

```typescript
const step1 = regexStep(/\d+/g, (acc, m) => {
  acc.numbers.push(Number(m[0]));
  return acc;
});

const step2 = regexStep(/[a-z]+/gi, (acc, m) => {
  acc.words.push(m[0]);
  return acc;
});

const pipeline = composeRegexPipelines(step1, step2);

const result = pipeline("123 abc 456 def", { numbers: [], words: [] });
console.log(result);
// {
//   data: { numbers: [123, 456], words: ['abc', 'def'] },
//   success: true,
//   executionTime: 0.523,
//   matchCount: 2
// }
```

---

### `composeAsyncRegexPipelines<T>(...steps)`

Composes multiple async regex steps into a single pipeline.

**Type Parameters:**
- `T` - Accumulator type

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `steps` | `AsyncRegexStep<T>[]` | Variable number of async regex steps |

**Returns:** Async pipeline function

**Example:**

```typescript
const pipeline = composeAsyncRegexPipelines(
  asyncRegexStep(/\d+/g, async (acc, m) => {
    acc.sum += Number(m[0]);
    return acc;
  })
);

const result = await pipeline("10 20 30", { sum: 0 });
```

---

## Fluent API

### `FluentRegexPipeline<T>`

Builder for constructing sync regex pipelines with a fluent interface.

**Type Parameters:**
- `T` - Accumulator/state type

**Constructor:**

```typescript
constructor(initialValue: T)
```

**Methods:**

#### `step<G>(regex, reducer): this`

Add a regex step to the pipeline.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `regex` | `RegExp` | Regular expression with `/g` flag |
| `reducer` | `RegexReducer<T, G>` | Function to process matches |

**Returns:** `this` - For method chaining

**Example:**

```typescript
pipeline.step(/\d+/g, (acc, m) => {
  acc.sum += Number(m[0]);
  return acc;
});
```

#### `run(str, options?): PipelineResult<T>`

Execute the pipeline.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `str` | `string` | Input string to process |
| `options` | `PipelineOptions?` | Execution options |

**Returns:** `PipelineResult<T>` - Result with data and metadata

**Example:**

```typescript
const result = pipeline.run("123 456", { debug: true });
console.log(result.data);        // Processed data
console.log(result.executionTime); // Execution time in ms
console.log(result.success);      // Boolean success flag
```

#### `reset(): this`

Clear all steps, keep initial value.

**Returns:** `this` - For method chaining

**Example:**

```typescript
pipeline.step(/\d+/g, reducer);
pipeline.run(input);
pipeline.reset();  // Remove all steps
pipeline.step(/\w+/g, newReducer); // Add new steps
```

#### `size(): number`

Get number of steps in pipeline.

**Returns:** `number` - Step count

**Example:**

```typescript
console.log(pipeline.size()); // 2
```

#### `clone(): FluentRegexPipeline<T>`

Create a deep copy of the pipeline.

**Returns:** `FluentRegexPipeline<T>` - New pipeline instance

**Example:**

```typescript
const pipeline2 = pipeline.clone();
pipeline2.step(/\w+/g, reducer); // Doesn't affect original
```

---

### `FluentAsyncRegexPipeline<T>`

Builder for constructing async regex pipelines.

**Type Parameters:**
- `T` - Accumulator/state type

**Constructor:**

```typescript
constructor(initialValue: T)
```

**Methods:**

#### `step<G>(regex, reducer): this`

Add an async regex step to the pipeline.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `regex` | `RegExp` | Regular expression with `/g` flag |
| `reducer` | `AsyncRegexReducer<T, G>` | Async function to process matches |

**Returns:** `this` - For method chaining

#### `async run(str, options?): Promise<PipelineResult<T>>`

Execute the async pipeline.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `str` | `string` | Input string to process |
| `options` | `PipelineOptions?` | Execution options |

**Returns:** `Promise<PipelineResult<T>>`

**Example:**

```typescript
const result = await pipeline.run("data", { timeout: 5000 });
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error);
}
```

#### `reset(): this`

Clear all steps.

**Returns:** `this` - For method chaining

#### `size(): number`

Get number of steps.

**Returns:** `number` - Step count

#### `clone(): FluentAsyncRegexPipeline<T>`

Create a copy of the pipeline.

**Returns:** `FluentAsyncRegexPipeline<T>` - New instance

---

## Utility Functions

### `processString<T>(str, initialValue, ...steps)`

One-liner for sync pipeline processing.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `str` | `string` | Input string |
| `initialValue` | `T` | Initial accumulator value |
| `...steps` | `...RegexStep<T>[]` | Regex steps |
| `options?` | `PipelineOptions` | Optional options (last parameter) |

**Returns:** `PipelineResult<T>`

**Example:**

```typescript
const result = processString(
  "1 2 3",
  { sum: 0 },
  regexStep(/\d+/g, (acc, m) => {
    acc.sum += Number(m[0]);
    return acc;
  }),
  { debug: true }
);
```

---

### `async processStringAsync<T>(str, initialValue, ...steps)`

One-liner for async pipeline processing.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `str` | `string` | Input string |
| `initialValue` | `T` | Initial accumulator value |
| `...steps` | `...AsyncRegexStep<T>[]` | Async regex steps |
| `options?` | `PipelineOptions` | Optional options |

**Returns:** `Promise<PipelineResult<T>>`

**Example:**

```typescript
const result = await processStringAsync(
  "data",
  { items: [] },
  asyncRegexStep(/\w+/g, async (acc, m) => {
    acc.items.push(m[0]);
    return acc;
  }),
  { timeout: 5000 }
);
```

---

### `runPipelines<T>(str, pipelines, options?)`

Run multiple independent pipelines.

**Type Parameters:**
- `T` - Result type

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `str` | `string` | Input string |
| `pipelines` | `Record<string, RegexStep<any>>` | Named pipelines |
| `options?` | `PipelineOptions` | Execution options |

**Returns:** `T` - Merged results

**Example:**

```typescript
const results = runPipelines(
  "123 abc 456 def",
  {
    numbers: regexStep<{ sum: number }>(/\d+/g, (acc, m) => {
      acc.sum = (acc.sum || 0) + Number(m[0]);
      return acc;
    }),
    words: regexStep<{ list: string[] }>(/\w+/g, (acc, m) => {
      acc.list = acc.list || [];
      acc.list.push(m[0]);
      return acc;
    })
  }
);

// results.numbers.sum = 579
// results.words.list = ["abc", "def"]
```

---

### `async runPipelinesAsync<T>(str, pipelines, options?)`

Run multiple independent async pipelines.

**Type Parameters:**
- `T` - Result type

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `str` | `string` | Input string |
| `pipelines` | `Record<string, AsyncRegexStep<any>>` | Named async pipelines |
| `options?` | `PipelineOptions` | Execution options |

**Returns:** `Promise<T>` - Merged async results

**Example:**

```typescript
const results = await runPipelinesAsync(
  "data",
  {
    async1: asyncRegexStep(/pattern/g, async (acc, m) => acc),
    async2: asyncRegexStep(/pattern/g, async (acc, m) => acc)
  },
  { timeout: 10000 }
);
```

---

## Types

### `RegexReducer<T, G>`

Synchronous reducer function.

```typescript
type RegexReducer<T, G extends Record<string, string> = Record<string, string>> = (
  acc: T,
  match: RegExpMatchArray & { groups?: G },
  index: number,
  allMatches: (RegExpMatchArray & { groups?: G })[],
  str: string
) => T;
```

**Parameters:**
- `acc` - Current accumulator value
- `match` - Current regex match
- `index` - Match index (0-based)
- `allMatches` - All matches in the string
- `str` - Original input string

---

### `AsyncRegexReducer<T, G>`

Asynchronous reducer function.

```typescript
type AsyncRegexReducer<T, G extends Record<string, string> = Record<string, string>> = (
  acc: T,
  match: RegExpMatchArray & { groups?: G },
  index: number,
  allMatches: (RegExpMatchArray & { groups?: G })[],
  str: string
) => Promise<T> | T;
```

---

### `RegexStep<T>`

Synchronous pipeline step.

```typescript
type RegexStep<T> = (str: string, acc: T) => T;
```

---

### `AsyncRegexStep<T>`

Asynchronous pipeline step.

```typescript
type AsyncRegexStep<T> = (str: string, acc: T) => Promise<T>;
```

---

### `PipelineOptions`

Options for pipeline execution.

```typescript
interface PipelineOptions {
  /** Throw on first error (default: true) */
  throwOnError?: boolean;

  /** Maximum time for async operations in ms */
  timeout?: number;

  /** Enable debug logging (default: false) */
  debug?: boolean;
}
```

---

### `PipelineResult<T>`

Result of pipeline execution.

```typescript
interface PipelineResult<T> {
  /** Processed data */
  data: T;

  /** Whether execution was successful */
  success: boolean;

  /** Error if one occurred */
  error?: Error;

  /** Execution time in milliseconds */
  executionTime: number;

  /** Number of matches/steps processed */
  matchCount: number;
}
```

---

### `PipelineError`

Custom error class for pipeline errors.

```typescript
class PipelineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  );
}
```

**Error Codes:**
- `REGEX_INVALID_FLAGS` - Regex missing `/g` flag
- `INPUT_TYPE_ERROR` - Input is not a string
- `REDUCER_ERROR` - Error in reducer function
- `ASYNC_REDUCER_ERROR` - Error in async reducer
- `STEP_ERROR` - Sync step execution error
- `ASYNC_STEP_ERROR` - Async step execution error
- `TIMEOUT_ERROR` - Operation exceeded timeout
- `INVALID_REGEX` - Null/undefined regex
- `INVALID_REDUCER` - Null/undefined reducer
- `INVALID_INIT_VALUE` - Null/undefined initial value

---

## Error Handling

### Basic Error Handling

```typescript
try {
  const result = pipeline.run(input);
  console.log(result.data);
} catch (error) {
  if (error instanceof PipelineError) {
    console.error(`Error: ${error.code} - ${error.message}`);
    console.error('Details:', error.details);
  }
}
```

### Graceful Error Handling

```typescript
const result = pipeline.run(input, { throwOnError: false });

if (!result.success) {
  console.error('Pipeline failed:', result.error?.message);
  // Handle error
} else {
  console.log('Result:', result.data);
}
```

### Timeout Handling

```typescript
const result = await pipeline.run(input, {
  timeout: 5000,
  throwOnError: false
});

if (result.error?.message.includes('timeout')) {
  console.error('Operation exceeded timeout');
}
```

---

## Complete Example

```typescript
import {
  FluentAsyncRegexPipeline,
  asyncRegexStep,
  PipelineError
} from 'regex-pipeline-module';

// Define types
type Config = Record<string, string>;
type Groups = { key: string; value: string };

// Create async pipeline
const configParser = new FluentAsyncRegexPipeline<Config>({})
  .step<Groups>(
    /(?<key>\w+)=(?<value>[^\n]+)/g,
    async (acc, match) => {
      if (match.groups) {
        // Simulate async validation
        await new Promise((r) => setTimeout(r, 10));
        acc[match.groups.key] = match.groups.value.trim();
      }
      return acc;
    }
  );

// Execute with options
(async () => {
  try {
    const result = await configParser.run(configText, {
      timeout: 5000,
      debug: true
    });

    console.log('Configuration:', result.data);
    console.log(`Parsed in ${result.executionTime}ms`);
  } catch (error) {
    if (error instanceof PipelineError) {
      console.error(`Parse error [${error.code}]:`, error.message);
    }
  }
})();
```

---

For more examples and use cases, see [README.md](README.md).
