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
// HIGHLY REFACTORED LOG INGESTION & AUDITING PIPELINES
// ==========================================

// Structured Domain Interfaces
type IngestionMetrics = {
  processedLines: number;
  severityCounts: Record<string, number>;
  uniqueIpAddresses: Set<string>;
  threatAudits: Array<{ ip: string; level: string; timestamp: string }>;
};

type LogRecordGroups = {
  timestamp: string;
  level: string;
  ip: string;
  service: string;
  message: string;
};

// Simulated external threat intelligence microservice lookup
async function queryThreatIntelService(ipAddress: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 8));
  if (ipAddress.startsWith("10.0") || ipAddress.startsWith("192.168.100")) {
    return "CRITICAL";
  }
  return "SAFE";
}

// 6. Refactored Fluent Log Ingestion Pipeline
const runOptimizedFluentLogPipeline = async () => {
  const auditLogStream = `
    [2026-07-26T22:00:00Z] INFO IP=192.168.1.10 SERVICE=auth-service User authenticated successfully
    [2026-07-26T22:01:15Z] ERROR IP=10.0.0.55 SERVICE=payment-gateway Unauthorized transaction mutation detected
    [2026-07-26T22:02:30Z] WARN IP=192.168.1.10 SERVICE=auth-service Elevated privilege token requested
  `;

  const logPipeline = new FluentAsyncRegexPipeline<IngestionMetrics>({
    processedLines: 0,
    severityCounts: {},
    uniqueIpAddresses: new Set<string>(),
    threatAudits: []
  })
    .step<LogRecordGroups>(
      /\[(?<timestamp>[^\]]+)\]\s+(?<level>\w+)\s+IP=(?<ip>[\d.]+)\s+SERVICE=(?<service>\S+)\s+(?<message>.+)/g,
      async (acc, match) => {
        const { timestamp, level, ip, service, message } = match.groups!;

        acc.processedLines++;
        acc.severityCounts[level] = (acc.severityCounts[level] || 0) + 1;
        acc.uniqueIpAddresses.add(ip);

        // Conditional asynchronous verification for suspicious service actions or risky IPs
        if (level === "ERROR" || service === "payment-gateway") {
          const threatLevel = await queryThreatIntelService(ip);
          acc.threatAudits.push({ ip, level: threatLevel, timestamp });
        }

        return acc;
      }
    );

  const finalMetrics = await logPipeline.run(auditLogStream);
  console.log("Example 6 (Optimized Fluent Log Ingestion):", {
    ...finalMetrics,
    uniqueIpAddresses: Array.from(finalMetrics.uniqueIpAddresses)
  });
};

// 7. Refactored Composed Async Auditing Pipeline (Separation of Parsing and Security Analysis)
const runOptimizedComposedAuditingPipeline = async () => {
  const telemetryFeed = "HOST=web-node-01 IP=192.168.100.5 EVENT=ROOT_LOGIN | HOST=db-node-02 IP=172.16.0.12 EVENT=QUERY_OK";

  type ComposedAuditState = {
    totalEvents: number;
    securityIncidents: string[];
  };

  const parseTelemetryStep = asyncRegexStep<ComposedAuditState>(/HOST=(?<host>\S+)\s+IP=(?<ip>[\d.]+)\s+EVENT=(?<event>\w+)/g, async (acc, match) => {
    await new Promise((r) => setTimeout(r, 5));
    acc.totalEvents++;
    return acc;
  });

  const evaluateSecurityRulesStep = asyncRegexStep<ComposedAuditState>(/HOST=(?<host>\S+)\s+IP=(?<ip>[\d.]+)\s+EVENT=(?<event>\w+)/g, async (acc, match) => {
    await new Promise((r) => setTimeout(r, 10));
    const { host, ip, event } = match.groups!;
    const threatRating = await queryThreatIntelService(ip);

    if (event === "ROOT_LOGIN" || threatRating === "CRITICAL") {
      acc.securityIncidents.push(`Security Alert: Host [${host}] from IP [${ip}] raised event [${event}] with threat rating [${threatRating}]`);
    }
    return acc;
  });

  const composedAuditor = composeAsyncRegexPipelines(parseTelemetryStep, evaluateSecurityRulesStep);

  const initialAuditState: ComposedAuditState = {
    totalEvents: 0,
    securityIncidents: []
  };

  const auditReport = await composedAuditor(telemetryFeed, initialAuditState);
  console.log("Example 7 (Optimized Composed Auditing Pipeline):", auditReport);
};

// Execute refactored async log pipelines
(async () => {
  await runOptimizedFluentLogPipeline();
  await runOptimizedComposedAuditingPipeline();
})();
