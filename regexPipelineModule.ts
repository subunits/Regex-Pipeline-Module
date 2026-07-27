// ==========================================
// SUPER REGEX PIPELINE MODULE - TypeScript
// ==========================================

// ------------------------------
// Types
// ------------------------------
type RegexReducer<T, G extends Record<string, string> = Record<string, string>> =
  (acc: T, match: RegExpMatchArray & { groups?: G }, index: number,
   allMatches: (RegExpMatchArray & { groups?: G })[], str: string) => T;

type AsyncRegexReducer<T, G extends Record<string, string> = Record<string, string>> =
  (acc: T, match: RegExpMatchArray & { groups?: G }, index: number,
   allMatches: (RegExpMatchArray & { groups?: G })[], str: string) => Promise<T> | T;

type RegexStep<T> = (str: string, acc: T) => T;
type AsyncRegexStep<T> = (str: string, acc: T) => Promise<T>;

// ------------------------------
// Curried Sync Step
// ------------------------------
function regexStep<T, G extends Record<string, string> = Record<string, string>>(regex: RegExp, reducer: RegexReducer<T, G>): RegexStep<T> {
  if (!regex.global) throw new Error("Regex must have /g flag");
  return (str: string, acc: T) => {
    const matches = [...str.matchAll(regex)] as (RegExpMatchArray & { groups?: G })[];
    return matches.reduce((a, m, i) => reducer(a, m, i, matches, str), acc);
  };
}

// ------------------------------
// Curried Async Step
// ------------------------------
function asyncRegexStep<T, G extends Record<string, string> = Record<string, string>>(regex: RegExp, reducer: AsyncRegexReducer<T, G>): AsyncRegexStep<T> {
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
function composeRegexPipelines<T>(...steps: RegexStep<T>[]): (str: string, initialValue: T) => T {
  return (str: string, initialValue: T) => steps.reduce((acc, step) => step(str, acc), initialValue);
}

function composeAsyncRegexPipelines<T>(...steps: AsyncRegexStep<T>[]): (str: string, initialValue: T) => Promise<T> {
  return async (str: string, initialValue: T) => {
    let acc = initialValue;
    for (const step of steps) { acc = await step(str, acc); }
    return acc;
  };
}

// ------------------------------
// Fluent API (Sync)
// ------------------------------
class FluentRegexPipeline<T> {
  private steps: RegexStep<T>[] = [];
  private initialValue: T;
  constructor(initialValue: T) { this.initialValue = initialValue; }
  step<G extends Record<string, string> = Record<string, string>>(regex: RegExp, reducer: RegexReducer<T, G>) {
    this.steps.push(regexStep(regex, reducer));
    return this;
  }
  run(str: string): T { return this.steps.reduce((acc, step) => step(str, acc), this.initialValue); }
  reset() { this.steps.length = 0; return this; }
}

// ------------------------------
// Fluent API (Async)
// ------------------------------
class FluentAsyncRegexPipeline<T> {
  private steps: AsyncRegexStep<T>[] = [];
  private initialValue: T;
  constructor(initialValue: T) { this.initialValue = initialValue; }
  step<G extends Record<string, string> = Record<string, string>>(regex: RegExp, reducer: AsyncRegexReducer<T, G>) {
    this.steps.push(asyncRegexStep(regex, reducer));
    return this;
  }
  async run(str: string): Promise<T> {
    let acc = this.initialValue;
    for (const step of this.steps) { acc = await step(str, acc); }
    return acc;
  }
  reset() { this.steps = []; return this; }
}

// ------------------------------
// One-liner processors
// ------------------------------
function processString<T extends Record<string, any>>(str: string, initialValue: T, ...steps: RegexStep<T>[]): T {
  return steps.reduce((acc, step) => step(str, acc), initialValue);
}

async function processStringAsync<T extends Record<string, any>>(str: string, initialValue: T, ...steps: AsyncRegexStep<T>[]): Promise<T> {
  let acc = initialValue;
  for (const step of steps) { acc = await step(str, acc); }
  return acc;
}

// ------------------------------
// Multi-pipeline merge
// ------------------------------
function runPipelines<T extends Record<string, any>>(str: string, pipelines: Record<string, RegexStep<any>>): T {
  const result: Record<string, any> = {};
  for (const key in pipelines) { result[key] = pipelines[key](str, {}); }
  return result as T;
}

async function runPipelinesAsync<T extends Record<string, any>>(str: string, pipelines: Record<string, AsyncRegexStep<any>>): Promise<T> {
  const result: Record<string, any> = {};
  for (const key in pipelines) { result[key] = await pipelines[key](str, {}); }
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
  .step(/\d+/g, async (acc, m) => { await new Promise(r => setTimeout(r, 10)); acc.sum += Number(m[0]); return acc; });
(async () => { console.log("Example2:", await asyncPipeline.run("10 cats,5 dogs,3 birds")); })();

// 3. Named capture groups, sync
type KVGroups = { key: string; value: string; }
const example3 = processString(
  "host=localhost port=5432 user=admin",
  {} as Record<string, string>,
  regexStep<Record<string, string>, KVGroups>(/(?<key>\w+)=(?<value>\w+)/g, (acc, m) => { acc[m.groups!.key] = m.groups!.value; return acc; })
);
console.log("Example3:", example3);

// 4. Multi-pipeline merge sync
const pipelines = {
  numbers: regexStep<{ sum: number }>(/\d+/g, (acc, m) => { acc.sum = (acc.sum || 0) + Number(m[0]); return acc; }),
  words4: regexStep<{ words: string[] }>(/\b\w{4}\b/g, (acc, m) => { acc.words = acc.words || []; acc.words.push(m[0]); return acc; })
};
const example4 = runPipelines<{ numbers: { sum: number }, words4: { words: string[] } }>("12 cats,7 dogs,four birds,9 pigs", pipelines);
console.log("Example4:", example4);

// 5. Multi-pipeline merge async
const asyncPipelines = {
  sumAsync: asyncRegexStep<{ sum: number }>(/\d+/g, async (acc, m) => { await new Promise(r => setTimeout(r, 5)); acc.sum = (acc.sum || 0) + Number(m[0]); return acc; }),
  wordsAsync: asyncRegexStep<{ words: string[] }>(/\b\w{4}\b/g, async (acc, m) => { await new Promise(r => setTimeout(r, 5)); acc.words = acc.words || []; acc.words.push(m[0]); return acc; })
};
(async () => {
  const example5 = await runPipelinesAsync<{ sumAsync: { sum: number }, wordsAsync: { words: string[] } }>("12 cats,7 dogs,four birds,9 pigs", asyncPipelines);
  console.log("Example5:", example5);
})();

// ==========================================
// ENHANCED ASYNC PIPELINE EXAMPLES
// ==========================================

// 6. Enterprise Log Ingestion & Asynchronous Enrichment Pipeline
type LogAuditState = {
  totalProcessed: number;
  authenticatedUsers: string[];
  flaggedThreats: { ip: string; reason: string }[];
};

const runEnhancedLogPipeline = async () => {
  const logStream = "Access from IP 192.168.1.50 by user:admin [status: SUCCESS]. Warning: malicious payload from IP 10.0.0.99 [status: BLOCKED].";

  const pipeline = new FluentAsyncRegexPipeline<LogAuditState>({
    totalProcessed: 0,
    authenticatedUsers: [],
    flaggedThreats: []
  })
    .step(/user:(?<username>\w+)/g, async (acc, match) => {
      // Simulate database lookup latency for user validation
      await new Promise((resolve) => setTimeout(resolve, 15));
      const user = match.groups?.username;
      if (user) {
        acc.totalProcessed++;
        if (!acc.authenticatedUsers.includes(user)) {
          acc.authenticatedUsers.push(user);
        }
      }
      return acc;
    })
    .step(/IP (?<ip>[\d.]+).*?\[status: (?<status>\w+)\]/g, async (acc, match) => {
      // Simulate security intelligence API call per IP match
      await new Promise((resolve) => setTimeout(resolve, 25));
      const ip = match.groups?.ip;
      const status = match.groups?.status;
      
      if (ip && status === "BLOCKED") {
        acc.flaggedThreats.push({ ip, reason: "Blocked connection attempt" });
      }
      return acc;
    });

  const result = await pipeline.run(logStream);
  console.log("Example 6 (Enterprise Log Ingestion Pipeline):", result);
};

// 7. Multi-stage Composed Async Sensor Telemetry Pipeline with Conditional Mutation
type TelemetryState = {
  readings: number[];
  peakValue: number;
  thresholdExceeded: boolean;
  alertLog: string[];
};

const runEnhancedComposedPipeline = async () => {
  const telemetryData = "Sensor-A: val=42, status=OK | Sensor-B: val=98, status=CRITICAL | Sensor-C: val=65, status=OK";

  // Step 1: Extract numeric metrics asynchronously and track peak values
  const parseMetricsStep = asyncRegexStep<TelemetryState>(/val=(?<val>\d+)/g, async (acc, match) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const val = Number(match.groups?.val);
    if (!isNaN(val)) {
      acc.readings.push(val);
      acc.peakValue = Math.max(acc.peakValue || 0, val);
    }
    return acc;
  });

  // Step 2: Correlate status flags and trigger asynchronous notifications if threshold is breached
  const analyzeStatusStep = asyncRegexStep<TelemetryState>(/status=(?<status>\w+)/g, async (acc, match) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const status = match.groups?.status;

    if (status === "CRITICAL" || (acc.peakValue && acc.peakValue > 90)) {
      acc.thresholdExceeded = true;
      acc.alertLog.push(`CRITICAL ALERT: Threshold breached! Peak value recorded at ${acc.peakValue}`);
    }
    return acc;
  });

  const composedPipeline = composeAsyncRegexPipelines(parseMetricsStep, analyzeStatusStep);

  const initialTelemetryState: TelemetryState = {
    readings: [],
    peakValue: 0,
    thresholdExceeded: false,
    alertLog: []
  };

  const finalState = await composedPipeline(telemetryData, initialTelemetryState);
  console.log("Example 7 (Composed Telemetry Pipeline):", finalState);
};

// Execute the enhanced examples
(async () => {
  await runEnhancedLogPipeline();
  await runEnhancedComposedPipeline();
})();
