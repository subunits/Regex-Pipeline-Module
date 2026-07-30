/**
 * Regex Pipeline Module - Main Entry Point
 * Production-grade TypeScript regex pipeline processor
 *
 * @packageDocumentation
 */

// Core functions
export { regexStep, asyncRegexStep, composeRegexPipelines, composeAsyncRegexPipelines } from './core';

// Fluent API
export { FluentRegexPipeline, FluentAsyncRegexPipeline } from './fluent';

// Utilities
export {
  processString,
  processStringAsync,
  runPipelines,
  runPipelinesAsync
} from './utils';

// Types
export type {
  RegexReducer,
  AsyncRegexReducer,
  RegexStep,
  AsyncRegexStep,
  PipelineOptions,
  PipelineResult
} from './types';

export { PipelineError } from './types';

// Version
export const VERSION = '1.0.0';
