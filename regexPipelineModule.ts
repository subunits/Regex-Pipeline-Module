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
  if (!regex.global) throw new Error("Regex must have /g flag");
  return (str: string, acc: T) => {
    const matches = [...str.matchAll(regex)] as (RegExpMatchArray & { groups?: G })[];
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
  if (!regex.global) throw new Error("Regex must have /g flag");
  return async (str: string, acc: T): Promise<T> => {
    let current = acc;
    const matches = [...str.matchAll(regex)] as (RegExpMatchArray & { groups?: G })[];
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

  constructor(private initialValue: T) {}

  public step<G extends Record<string, string> = Record<string, string>>(
    regex: RegExp,
    reducer: RegexReducer<T, G>
  ): this {
    this.steps.push(regexStep(regex, reducer));
    return this;
  }

  public run(str: string): T {
    return this.steps.reduce((acc, step) => step(str, acc), this.initialValue);
  }

  public reset(): this {
    this.steps.length = 0;
    return this;
  }
}

// ------------------------------
// Fluent API (Async)
// ------------------------------
export class FluentAsyncRegexPipeline<T> {
  private steps: AsyncRegexStep<T>[] = [];

  constructor(private initialValue: T) {}

  public step<G extends Record<string, string> = Record<string, string>>(
    regex: RegExp,
    reducer: AsyncRegexReducer<T, G>
  ): this {
    this.steps.push(asyncRegexStep(regex, reducer));
    return this;
  }

  public async run(str: string): Promise<T> {
    let acc = this.initialValue;
    for (const step of this.steps) {
      acc = await step(str, acc);
    }
    return acc;
  }

  public reset(): this {
    this.steps = [];
    return this;
  }
}

// ------------------------------
// One-Liner Processors
// ------------------------------
export function processString<T extends Record<string, any>>(
  str: string,
  initialValue: T,
  ...steps: RegexStep<T>[]
): T {
  return steps.reduce((acc, step) => step(str, acc), initialValue);
}

export async function processStringAsync<T extends Record<string, any>>(
  str: string,
  initialValue: T,
  ...steps: AsyncRegexStep<T>[]
): Promise<T> {
  let acc = initialValue;
  for (const step of steps) {
    acc = await step(str, acc);
  }
  return acc;
}

// ------------------------------
// Multi-Pipeline Merge
// ------------------------------
export function runPipelines<T extends Record<string, any>>(
  str: string,
  pipelines: Record<string, RegexStep<any>>
): T {
  const result: Record<string, any> = {};
  for (const key in pipelines) {
    result[key] = pipelines[key](str, {});
  }
  return result as T;
}

export async function runPipelinesAsync<T extends Record<string, any>>(
  str: string,
  pipelines: Record<string, AsyncRegexStep<any>>
): Promise<T> {
  const result: Record<string, any> = {};
  for (const key in pipelines) {
    result[key] = await pipelines[key](str, {});
  }
  return result as T;
}
