/**
 * Regex Pipeline Module — Utility Functions
 */

import {
  RegexStep,
  AsyncRegexStep,
  PipelineOptions,
  PipelineResult,
  PipelineError,
} from './types';

// ─── One-Liner Processors ──────────────────────────────────────────────────────

export function processString<T extends Record<string, unknown>>(
  str: string,
  initialValue: T,
  ...steps: RegexStep<T>[]
): PipelineResult<T>;
export function processString<T extends Record<string, unknown>>(
  str: string,
  initialValue: T,
  ...stepsAndOptions: [...RegexStep<T>[], PipelineOptions]
): PipelineResult<T>;
export function processString<T extends Record<string, unknown>>(
  str: string,
  initialValue: T,
  ...args: (RegexStep<T> | PipelineOptions)[]
): PipelineResult<T> {
  const { steps, options } = splitArgs<RegexStep<T>>(args);
  return runSync(str, initialValue, steps, options);
}

export async function processStringAsync<T extends Record<string, unknown>>(
  str: string,
  initialValue: T,
  ...steps: AsyncRegexStep<T>[]
): Promise<PipelineResult<T>>;
export async function processStringAsync<T extends Record<string, unknown>>(
  str: string,
  initialValue: T,
  ...stepsAndOptions: [...AsyncRegexStep<T>[], PipelineOptions]
): Promise<PipelineResult<T>>;
export async function processStringAsync<T extends Record<string, unknown>>(
  str: string,
  initialValue: T,
  ...args: (AsyncRegexStep<T> | PipelineOptions)[]
): Promise<PipelineResult<T>> {
  const { steps, options } = splitArgs<AsyncRegexStep<T>>(args);
  return runAsync(str, initialValue, steps, options);
}

// ─── Multi-Pipeline Merge ──────────────────────────────────────────────────────

export function runPipelines<T extends Record<string, unknown>>(
  str: string,
  pipelines: Record<string, RegexStep<Record<string, unknown>>>,
  _options: PipelineOptions = {}
): T {
  const result: Record<string, unknown> = {};
  for (const [key, step] of Object.entries(pipelines)) {
    result[key] = step(str, {});
  }
  return result as T;
}

export async function runPipelinesAsync<T extends Record<string, unknown>>(
  str: string,
  pipelines: Record<string, AsyncRegexStep<Record<string, unknown>>>,
  options: PipelineOptions = {}
): Promise<T> {
  const result: Record<string, unknown> = {};
  for (const [key, step] of Object.entries(pipelines)) {
    const p = step(str, {});
    result[key] = options.timeout != null ? await applyTimeout(p, options.timeout) : await p;
  }
  return result as T;
}

// ─── Shared Sync / Async Runners ──────────────────────────────────────────────

function runSync<T>(
  str: string,
  initialValue: T,
  steps: RegexStep<T>[],
  options: PipelineOptions
): PipelineResult<T> {
  const { throwOnError = true, debug = false } = options;
  const startTime = performance.now();
  let matchCount = 0;
  let acc: T = JSON.parse(JSON.stringify(initialValue));

  try {
    for (const step of steps) {
      acc = step(str, acc);
      matchCount++;
      if (debug) console.debug('[processString] step done', acc);
    }
  } catch (err) {
    const e = err instanceof PipelineError ? err : new PipelineError(String(err), 'STEP_ERROR', err);
    if (throwOnError) throw e;
    return { data: acc, success: false, error: e, executionTime: performance.now() - startTime, matchCount };
  }

  return { data: acc, success: true, executionTime: performance.now() - startTime, matchCount };
}

async function runAsync<T>(
  str: string,
  initialValue: T,
  steps: AsyncRegexStep<T>[],
  options: PipelineOptions
): Promise<PipelineResult<T>> {
  const { throwOnError = true, debug = false, timeout } = options;
  const startTime = performance.now();
  let matchCount = 0;
  let acc: T = JSON.parse(JSON.stringify(initialValue));

  try {
    for (const step of steps) {
      const p = step(str, acc);
      acc = timeout != null ? await applyTimeout(p, timeout) : await p;
      matchCount++;
      if (debug) console.debug('[processStringAsync] step done', acc);
    }
  } catch (err) {
    const e = err instanceof PipelineError ? err : new PipelineError(String(err), 'ASYNC_STEP_ERROR', err);
    if (throwOnError) throw e;
    return { data: acc, success: false, error: e, executionTime: performance.now() - startTime, matchCount };
  }

  return { data: acc, success: true, executionTime: performance.now() - startTime, matchCount };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function splitArgs<S>(args: (S | PipelineOptions)[]): { steps: S[]; options: PipelineOptions } {
  if (args.length === 0) return { steps: [], options: {} };
  const last = args[args.length - 1];
  if (isOptions(last)) {
    return { steps: args.slice(0, -1) as S[], options: last };
  }
  return { steps: args as S[], options: {} };
}

function isOptions(v: unknown): v is PipelineOptions {
  if (typeof v !== 'object' || v === null || typeof v === 'function') return false;
  const keys = new Set(Object.keys(v));
  return keys.has('throwOnError') || keys.has('timeout') || keys.has('debug');
}

function applyTimeout<V>(promise: Promise<V>, ms: number): Promise<V> {
  return new Promise<V>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new PipelineError(`Operation exceeded ${ms}ms timeout`, 'TIMEOUT_ERROR')),
      ms
    );
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
