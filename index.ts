/**
 * Regex Pipeline Module - Main Entry Point
 * Production-grade TypeScript regex pipeline processor
 *
 * @packageDocumentation
 */

// Core functions
export { regexStep, asyncRegexStep, composeRegexPipelines, composeAsyncRegexPipelines } from './src/core';

// Fluent API
export { FluentRegexPipeline, FluentAsyncRegexPipeline } from './src/fluent';

// Utilities
export {
  processString,
  processStringAsync,
  runPipelines,
  runPipelinesAsync
} from './src/utils';

// Types
export type {
  RegexReducer,
  AsyncRegexReducer,
  RegexStep,
  AsyncRegexStep,
  PipelineOptions,
  PipelineResult
} from './src/types';

export { PipelineError } from './src/types';

// Version
export const VERSION = '1.0.0';
