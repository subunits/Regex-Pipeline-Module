/**
 * Regex Pipeline Module — Core Functions
 *
 * regexStep / asyncRegexStep       — compile a reducer into a reusable step
 * composeRegexPipelines            — merge N sync steps into one pipeline fn
 * composeAsyncRegexPipelines       — merge N async steps into one pipeline fn
 */

import {
  RegexReducer,
  AsyncRegexReducer,
  RegexStep,
  AsyncRegexStep,
  PipelineOptions,
  PipelineResult,
  PipelineError,
} from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateRegex(regex: RegExp): void {
  if (regex == null) {
    throw new PipelineError('Regex must not be null or undefined', 'INVALID_REGEX');
  }
  if (!regex.global) {
    throw new PipelineError(
      `Regex /${regex.source}/ must have the /g flag`,
      'REGEX_INVALID_FLAGS',
      { regex: regex.toString() }
    );
  }
}

function validateReducer(reducer: unknown): void {
  if (reducer == null) {
    throw new PipelineError('Reducer must not be null or undefined', 'INVALID_REDUCER');
  }
}

function validateInput(str: unknown): void {
  if (typeof str !== 'string') {
    throw new PipelineError(
      `Input must be a string, got ${typeof str}`,
      'INPUT_TYPE_ERROR',
      { received: typeof str }
    );
  }
}

function makePipelineResult<T>(
  data: T,
  matchCount: number,
  startTime: number,
  error?: Error
): PipelineResult<T> {
  return {
    data,
    success: error == null,
    error,
    executionTime: performance.now() - startTime,
    matchCount,
  };
}

/** Wrap a timeout around an async operation. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PipelineError(`Operation exceeded ${ms}ms timeout`, 'TIMEOUT_ERROR')),
      ms
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// ─── Core Step Factories ──────────────────────────────────────────────────────

/**
 * Creates a synchronous regex processing step.
 *
 * @example
 * const step = regexStep(/\d+/g, (acc, m) => { acc.sum += Number(m[0]); return acc; });
 * const result = step("1 2 3", { sum: 0 });  // { sum: 6 }
 */
export function regexStep<
  T,
  G extends Record<string, string> = Record<string, string>
>(regex: RegExp, reducer: RegexReducer<T, G>): RegexStep<T> {
  validateRegex(regex);
  validateReducer(reducer);

  return (str: string, acc: T): T => {
    validateInput(str);
    // matchAll requires the regex to be reset between calls — clone with same flags
    const re = new RegExp(regex.source, regex.flags);
    const matches = [...str.matchAll(re)] as (RegExpMatchArray & { groups?: G })[];
    try {
      return matches.reduce((a, m, i) => reducer(a, m, i, matches, str), acc);
    } catch (err) {
      throw new PipelineError(
        `Reducer error at match index: ${err instanceof Error ? err.message : String(err)}`,
        'REDUCER_ERROR',
        err
      );
    }
  };
}

/**
 * Creates an asynchronous regex processing step.
 *
 * @example
 * const step = asyncRegexStep(/\w+/g, async (acc, m) => {
 *   acc.items.push(await fetchLabel(m[0]));
 *   return acc;
 * });
 */
export function asyncRegexStep<
  T,
  G extends Record<string, string> = Record<string, string>
>(regex: RegExp, reducer: AsyncRegexReducer<T, G>): AsyncRegexStep<T> {
  validateRegex(regex);
  validateReducer(reducer);

  return async (str: string, acc: T): Promise<T> => {
    validateInput(str);
    const re = new RegExp(regex.source, regex.flags);
    const matches = [...str.matchAll(re)] as (RegExpMatchArray & { groups?: G })[];
    let current = acc;
    for (let i = 0; i < matches.length; i++) {
      try {
        current = await reducer(current, matches[i], i, matches, str);
      } catch (err) {
        throw new PipelineError(
          `Async reducer error at match ${i}: ${err instanceof Error ? err.message : String(err)}`,
          'ASYNC_REDUCER_ERROR',
          err
        );
      }
    }
    return current;
  };
}

// ─── Pipeline Composers ───────────────────────────────────────────────────────

/**
 * Composes multiple sync steps into a single pipeline function that returns
 * a typed `PipelineResult<T>`.
 *
 * @example
 * const pipeline = composeRegexPipelines(stepA, stepB);
 * const result = pipeline("input", { numbers: [], words: [] });
 * console.log(result.data, result.executionTime, result.matchCount);
 */
export function composeRegexPipelines<T>(
  ...steps: RegexStep<T>[]
): (str: string, initialValue: T, options?: PipelineOptions) => PipelineResult<T> {
  return (str: string, initialValue: T, options: PipelineOptions = {}): PipelineResult<T> => {
    const { throwOnError = true, debug = false } = options;
    const startTime = performance.now();
    let matchCount = 0;

    if (initialValue == null) {
      const err = new PipelineError('initialValue must not be null or undefined', 'INVALID_INIT_VALUE');
      if (throwOnError) throw err;
      return makePipelineResult(initialValue as NonNullable<T>, 0, startTime, err);
    }

    let acc = initialValue as NonNullable<T>;
    try {
      for (const step of steps) {
        const before = JSON.stringify(acc);
        acc = step(str, acc) as NonNullable<T>;
        // Rough match-count heuristic: count array-length changes for array accumulators
        if (debug) {
          console.debug('[RegexPipeline] step completed', { before: JSON.parse(before), after: acc });
        }
        matchCount++;
      }
    } catch (err) {
      const pErr = err instanceof PipelineError
        ? err
        : new PipelineError(String(err), 'STEP_ERROR', err);
      if (throwOnError) throw pErr;
      return makePipelineResult(acc, matchCount, startTime, pErr);
    }

    return makePipelineResult(acc, matchCount, startTime);
  };
}

/**
 * Composes multiple async steps into a single async pipeline function.
 *
 * @example
 * const pipeline = composeAsyncRegexPipelines(stepA, stepB);
 * const result = await pipeline("input", { sum: 0 }, { timeout: 5000 });
 */
export function composeAsyncRegexPipelines<T>(
  ...steps: AsyncRegexStep<T>[]
): (str: string, initialValue: T, options?: PipelineOptions) => Promise<PipelineResult<T>> {
  return async (
    str: string,
    initialValue: T,
    options: PipelineOptions = {}
  ): Promise<PipelineResult<T>> => {
    const { throwOnError = true, debug = false, timeout } = options;
    const startTime = performance.now();
    let matchCount = 0;

    if (initialValue == null) {
      const err = new PipelineError('initialValue must not be null or undefined', 'INVALID_INIT_VALUE');
      if (throwOnError) throw err;
      return makePipelineResult(initialValue as NonNullable<T>, 0, startTime, err);
    }

    let acc = initialValue as NonNullable<T>;
    try {
      for (const step of steps) {
        const stepPromise = step(str, acc);
        acc = (timeout != null ? await withTimeout(stepPromise, timeout) : await stepPromise) as NonNullable<T>;
        if (debug) {
          console.debug('[AsyncRegexPipeline] step completed', { acc });
        }
        matchCount++;
      }
    } catch (err) {
      const pErr = err instanceof PipelineError
        ? err
        : new PipelineError(String(err), 'ASYNC_STEP_ERROR', err);
      if (throwOnError) throw pErr;
      return makePipelineResult(acc, matchCount, startTime, pErr);
    }

    return makePipelineResult(acc, matchCount, startTime);
  };
}
