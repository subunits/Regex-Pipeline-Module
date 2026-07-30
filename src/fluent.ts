/**
 * Regex Pipeline Module — Fluent API
 *
 * FluentRegexPipeline      — builder for sync pipelines
 * FluentAsyncRegexPipeline — builder for async pipelines
 *
 * Both expose: step(), run(), reset(), size(), clone()
 */

import {
  RegexReducer,
  AsyncRegexReducer,
  RegexStep,
  AsyncRegexStep,
  PipelineOptions,
  PipelineResult,
} from './types';

import { regexStep, asyncRegexStep } from './core';

// ─── Sync Fluent Pipeline ─────────────────────────────────────────────────────

/**
 * Builder for constructing sync regex pipelines with a fluent interface.
 *
 * @example
 * const result = new FluentRegexPipeline({ count: 0, words: [] as string[] })
 *   .step(/\d+/g, (acc, m) => { acc.count += Number(m[0]); return acc; })
 *   .step(/[a-z]+/gi, (acc, m) => { acc.words.push(m[0]); return acc; })
 *   .run("12 cats 7 dogs");
 *
 * console.log(result.data); // { count: 19, words: ['cats', 'dogs'] }
 */
export class FluentRegexPipeline<T> {
  private readonly _initial: T;
  private _steps: RegexStep<T>[] = [];

  constructor(initialValue: T) {
    this._initial = initialValue;
  }

  /**
   * Add a synchronous regex step to the pipeline.
   * Returns `this` for chaining.
   */
  step<G extends Record<string, string> = Record<string, string>>(
    regex: RegExp,
    reducer: RegexReducer<T, G>
  ): this {
    this._steps.push(regexStep<T, G>(regex, reducer));
    return this;
  }

  /**
   * Execute the pipeline against `str`.
   * Steps run in registration order; the initial value is reset each call.
   */
  run(str: string, options: PipelineOptions = {}): PipelineResult<T> {
    const { throwOnError = true, debug = false } = options;
    const startTime = performance.now();
    let matchCount = 0;
    // Deep-clone initialValue so repeated run() calls don't share mutable state
    let acc: T = JSON.parse(JSON.stringify(this._initial));

    try {
      for (const step of this._steps) {
        acc = step(str, acc);
        matchCount++;
        if (debug) {
          console.debug('[FluentRegexPipeline] step done', { acc });
        }
      }
    } catch (err) {
      if (throwOnError) throw err;
      return {
        data: acc,
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
        executionTime: performance.now() - startTime,
        matchCount,
      };
    }

    return {
      data: acc,
      success: true,
      executionTime: performance.now() - startTime,
      matchCount,
    };
  }

  /** Remove all steps; the initial value is kept. Returns `this`. */
  reset(): this {
    this._steps = [];
    return this;
  }

  /** Number of steps currently registered. */
  size(): number {
    return this._steps.length;
  }

  /**
   * Return a new `FluentRegexPipeline` with the same initial value and a
   * shallow copy of the current step list.
   */
  clone(): FluentRegexPipeline<T> {
    const copy = new FluentRegexPipeline<T>(this._initial);
    copy._steps = [...this._steps];
    return copy;
  }
}

// ─── Async Fluent Pipeline ────────────────────────────────────────────────────

/**
 * Builder for constructing async regex pipelines.
 *
 * @example
 * const result = await new FluentAsyncRegexPipeline({ sum: 0 })
 *   .step(/\d+/g, async (acc, m) => {
 *     await delay(10);
 *     acc.sum += Number(m[0]);
 *     return acc;
 *   })
 *   .run("10 20 30", { timeout: 2000 });
 *
 * console.log(result.data.sum); // 60
 */
export class FluentAsyncRegexPipeline<T> {
  private readonly _initial: T;
  private _steps: AsyncRegexStep<T>[] = [];

  constructor(initialValue: T) {
    this._initial = initialValue;
  }

  /**
   * Add an asynchronous regex step. Returns `this` for chaining.
   */
  step<G extends Record<string, string> = Record<string, string>>(
    regex: RegExp,
    reducer: AsyncRegexReducer<T, G>
  ): this {
    this._steps.push(asyncRegexStep<T, G>(regex, reducer));
    return this;
  }

  /**
   * Execute all async steps in registration order.
   * Supports `timeout` and `throwOnError` options.
   */
  async run(str: string, options: PipelineOptions = {}): Promise<PipelineResult<T>> {
    const { throwOnError = true, debug = false, timeout } = options;
    const startTime = performance.now();
    let matchCount = 0;
    let acc: T = JSON.parse(JSON.stringify(this._initial));

    const withTimeout = <V>(p: Promise<V>): Promise<V> => {
      if (timeout == null) return p;
      return new Promise<V>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`TIMEOUT_ERROR: exceeded ${timeout}ms`)),
          timeout
        );
        p.then(
          (v) => { clearTimeout(timer); resolve(v); },
          (e) => { clearTimeout(timer); reject(e); }
        );
      });
    };

    try {
      for (const step of this._steps) {
        acc = await withTimeout(step(str, acc));
        matchCount++;
        if (debug) {
          console.debug('[FluentAsyncRegexPipeline] step done', { acc });
        }
      }
    } catch (err) {
      if (throwOnError) throw err;
      return {
        data: acc,
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
        executionTime: performance.now() - startTime,
        matchCount,
      };
    }

    return {
      data: acc,
      success: true,
      executionTime: performance.now() - startTime,
      matchCount,
    };
  }

  /** Remove all steps; initial value is kept. Returns `this`. */
  reset(): this {
    this._steps = [];
    return this;
  }

  /** Number of steps currently registered. */
  size(): number {
    return this._steps.length;
  }

  /** Return a new pipeline with the same initial value and copied steps. */
  clone(): FluentAsyncRegexPipeline<T> {
    const copy = new FluentAsyncRegexPipeline<T>(this._initial);
    copy._steps = [...this._steps];
    return copy;
  }
}
