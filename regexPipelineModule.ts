// ==========================================
// SUPER REGEX PIPELINE MODULE - TypeScript
// ==========================================

// ------------------------------
// Types
// ------------------------------
export type RegexReducer<T, G extends Record<string, string> = Record<string, string>> =
  (acc: T, match: RegExpMatchArray & { groups?: G }, index: number,
   allMatches: (RegExpMatchArray & { groups?: G })[], str: string) => T;

export type AsyncRegexReducer<T, G extends Record<string, string> = Record<string, string>> =
  (acc: T, match: RegExpMatchArray & { groups?: G }, index: number,
   allMatches: (RegExpMatchArray & { groups?: G })[], str: string) => Promise<T> | T;

export type RegexStep<T> = (str: string, acc: T) => T;
export type AsyncRegexStep<T> = (str: string, acc: T) => Promise<T>;

// ------------------------------
// Curried Sync Step
// ------------------------------
export function regexStep<T, G extends Record<string, string> = Record<string, string>>(
  regex: RegExp, 
  reducer: RegexReducer<T, G>
): RegexStep<T> {
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
  const safeRegex = new RegExp(regex.source, flags);

  return (str: string, acc: T) => {
    safeRegex.lastIndex = 0;
    const matches = [...str.matchAll(safeRegex)] as (RegExpMatchArray & { groups?: G })[];
    return matches.reduce((a, m, i) => reducer(a, m, i, matches, str), acc);
  };
}

// ------------------------------
// Curried Async Step
// ------------------------------
export function asyncRegexStep<T, G extends Record<string, string> = Record<string, string>>(
  regex: RegExp, 
  reducer: AsyncRegexReducer<T, G>
): AsyncRegexStep<T> {
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
  const safeRegex = new RegExp(regex.source, flags);

  return async (str: string, acc: T): Promise<T> => {
    safeRegex.lastIndex = 0;
    let current = acc;
    const matches = [...str.matchAll(safeRegex)] as (RegExpMatchArray & { groups?: G })[];
    for (let i = 0; i < matches.length; i++) {
      current = await reducer(current, matches[i], i, matches, str);
    }
    return current;
  };
}

// ------------------------------
// Compose Multiple Pipelines
// ------------------------------
export function composeRegexPipelines<T>(...steps: RegexStep<T>[]): (str: string, initialValue: T) => T {
  return (str: string, initialValue: T) => steps.reduce((acc, step) => step(str, acc), initialValue);
}

export function composeAsyncRegexPipelines<T>(...steps: AsyncRegexStep<T>[]): (str: string, initialValue: T) => Promise<T> {
  return async (str: string, initialValue: T) => {
    let acc = initialValue;
    for (const step of steps) { 
      acc = await step(str, acc); 
    }
    return acc;
  };
}

// ------------------------------
// Fluent API (Sync)
// ------------------------------
export class FluentRegexPipeline<T> {
  private steps: RegexStep<T>[] = [];
  private initialValue: T;

  constructor(initialValue: T) { 
    this.initialValue = initialValue; 
  }

  step<G extends Record<string, string> = Record<string, string>>(regex: RegExp, reducer: RegexReducer<T, G>) {
    this.steps.push(regexStep(regex, reducer));
    return this;
  }

  run(str: string): T { 
    return this.steps.reduce((acc, step) => step(str, acc), this.initialValue); 
  }

  reset() { 
    this.steps.length = 0; 
    return this; 
  }
}

// ------------------------------
// Fluent API (Async)
// ------------------------------
export class FluentAsyncRegexPipeline<T> {
  private steps: AsyncRegexStep<T>[] = [];
  private initialValue: T;

  constructor(initialValue: T) { 
    this.initialValue = initialValue; 
  }

  step<G extends Record<string, string> = Record<string, string>>(regex: RegExp, reducer: AsyncRegexReducer<T, G>) {
    this.steps.push(asyncRegexStep(regex, reducer));
    return this;
  }

  async run(str: string): Promise<T> {
    let acc = this.initialValue;
    for (const step of this.steps) { 
      acc = await step(str, acc); 
    }
    return acc;
  }

  reset() { 
    this.steps = []; 
    return this; 
  }
}

// ------------------------------
// One-liner processors
// ------------------------------
export function processString<T extends Record<string, any>>(str: string, initialValue: T, ...steps: RegexStep<T>[]): T {
  return steps.reduce((acc, step) => step(str, acc), initialValue);
}

export async function processStringAsync<T extends Record<string, any>>(str: string, initialValue: T, ...steps: AsyncRegexStep<T>[]): Promise<T> {
  let acc = initialValue;
  for (const step of steps) { 
    acc = await step(str, acc); 
  }
  return acc;
}

// ------------------------------
// Multi-pipeline merge
// ------------------------------
export function runPipelines<T extends Record<string, any>>(str: string, pipelines: Record<string, RegexStep<any>>): T {
  const result: Record<string, any> = {};
  for (const key in pipelines) { 
    result[key] = pipelines[key](str, {}); 
  }
  return result as T;
}

export async function runPipelinesAsync<T extends Record<string, any>>(str: string, pipelines: Record<string, AsyncRegexStep<any>>): Promise<T> {
  const result: Record<string, any> = {};
  for (const key in pipelines) { 
    result[key] = await pipelines[key](str, {}); 
  }
  return result as T;
}

// ==========================================
// EXAMPLES
// ==========================================

// 1. Sync counting and 4-letter words
const example1 = processString(
  "12 cats, 7 dogs, four birds, 9 pigs",
  { count: 0, words4: [] as string[] },
  regexStep((/\d+/g), (acc, m) => { acc.count += Number(m[0]); return acc; }),
  regexStep(/\b\w{4}\b/g, (acc, m) => { acc.words4.push(m[0]); return acc; })
);
console.log("Example1:", example1);

// 2. Async sum with delay
const asyncPipeline = new FluentAsyncRegexPipeline({ sum: 0 })
  .step(/\d+/g, async (acc, m) => { 
    await new Promise(r => setTimeout(r, 10)); 
    acc.sum += Number(m[0]); 
    return acc; 
  });
(async () => { 
  console.log("Example2:", await asyncPipeline.run("10 cats,5 dogs,3 birds")); 
})();

// 3. Named capture groups, sync
type KVGroups = { key: string; value: string; }
const example3 = processString(
  "host=localhost port=5432 user=admin",
  {} as Record<string, string>,
  regexStep<Record<string, string>, KVGroups>(/(?<key>\w+)=(?<value>\w+)/g, (acc, m) => { 
    acc[m.groups!.key] = m.groups!.value; 
    return acc; 
  })
);
console.log("Example3:", example3);

// 4. Multi-pipeline merge sync
const pipelines = {
  numbers: regexStep<{ sum: number }>(/\d+/g, (acc, m) => { 
    acc.sum = (acc.sum || 0) + Number(m[0]); 
    return acc; 
  }),
  words4: regexStep<{ words: string[] }>(/\b\w{4}\b/g, (acc, m) => { 
    acc.words = acc.words || []; 
    acc.words.push(m[0]); 
    return acc; 
  })
};
const example4 = runPipelines<{ numbers: { sum: number }, words4: { words: string[] } }>("12 cats,7 dogs,four birds,9 pigs", pipelines);
console.log("Example4:", example4);

// 5. Multi-pipeline merge async
const asyncPipelines = {
  sumAsync: asyncRegexStep<{ sum: number }>(/\d+/g, async (acc, m) => { 
    await new Promise(r => setTimeout(r, 5)); 
    acc.sum = (acc.sum || 0) + Number(m[0]); 
    return acc; 
  }),
  wordsAsync: asyncRegexStep<{ words: string[] }>(/\b\w{4}\b/g, async (acc, m) => { 
    await new Promise(r => setTimeout(r, 5)); 
    acc.words = acc.words || []; 
    acc.words.push(m[0]); 
    return acc; 
  })
};
(async () => {
  const example5 = await runPipelinesAsync<{ sumAsync: { sum: number }, wordsAsync: { words: string[] } }>("12 cats,7 dogs,four birds,9 pigs", asyncPipelines);
  console.log("Example5:", example5);
})();
