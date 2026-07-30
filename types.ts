/**
 * Regex Pipeline Module — Type Definitions
 * All shared types, interfaces, and the PipelineError class.
 */

// ─── Reducer Types ────────────────────────────────────────────────────────────

/**
 * Synchronous reducer called once per regex match.
 * @typeParam T  Accumulator type
 * @typeParam G  Named capture groups shape
 */
export type RegexReducer<
  T,
  G extends Record<string, string> = Record<string, string>
> = (
  acc: T,
  match: RegExpMatchArray & { groups?: G },
  index: number,
  allMatches: (RegExpMatchArray & { groups?: G })[],
  str: string
) => T;

/**
 * Asynchronous reducer called once per regex match.
 * May return a plain value or a Promise.
 */
export type AsyncRegexReducer<
  T,
  G extends Record<string, string> = Record<string, string>
> = (
  acc: T,
  match: RegExpMatchArray & { groups?: G },
  index: number,
  allMatches: (RegExpMatchArray & { groups?: G })[],
  str: string
) => Promise<T> | T;

// ─── Step Types ───────────────────────────────────────────────────────────────

/** A compiled synchronous pipeline step: (str, acc) → acc */
export type RegexStep<T> = (str: string, acc: T) => T;

/** A compiled asynchronous pipeline step: (str, acc) → Promise<acc> */
export type AsyncRegexStep<T> = (str: string, acc: T) => Promise<T>;

// ─── Options & Result ─────────────────────────────────────────────────────────

/** Options accepted by pipeline execution methods. */
export interface PipelineOptions {
  /** Throw on first reducer/step error. Default: true */
  throwOnError?: boolean;
  /** Maximum milliseconds for async operations before TIMEOUT_ERROR */
  timeout?: number;
  /** Emit debug timing/match info to console. Default: false */
  debug?: boolean;
}

/** Typed return value from all pipeline run methods. */
export interface PipelineResult<T> {
  /** The final accumulated data after all steps complete */
  data: T;
  /** true if every step completed without error */
  success: boolean;
  /** Populated when success is false and throwOnError is false */
  error?: Error;
  /** Wall-clock execution time in milliseconds */
  executionTime: number;
  /** Total number of regex matches processed across all steps */
  matchCount: number;
}

// ─── Error Class ──────────────────────────────────────────────────────────────

/**
 * Structured error thrown (or stored) by pipeline operations.
 *
 * Error codes:
 *  REGEX_INVALID_FLAGS  — regex missing /g flag
 *  INVALID_REGEX        — null/undefined regex
 *  INVALID_REDUCER      — null/undefined reducer
 *  INVALID_INIT_VALUE   — null/undefined initial accumulator
 *  INPUT_TYPE_ERROR     — input is not a string
 *  REDUCER_ERROR        — sync reducer threw
 *  ASYNC_REDUCER_ERROR  — async reducer threw
 *  STEP_ERROR           — sync step threw
 *  ASYNC_STEP_ERROR     — async step threw
 *  TIMEOUT_ERROR        — async operation exceeded timeout
 */
export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'PipelineError';
    // Restore prototype chain in environments that transpile classes
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
