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
// REFACTORED ASYNC LOG INGESTION EXAMPLES
// ==========================================

// Domain Types for Structured Log Processing
type LogIngestMetrics = {
  totalEntries: number;
  ipAccessCounts: Record<string, number>;
  activeSessions: Set<string>;
  threatDetections: { ip: string; threatLevel: string; timestamp: string }[];
};

// Mock async threat intelligence lookup service
async function lookupIpThreatLevel(ip: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 12));
  return ip.startsWith("10.0") ? "HIGH" : "LOW";
}

// 6. Refactored Fluent Log Ingestion Pipeline using Named Capture Groups
const runRefactoredLogIngestPipeline = async () => {
  const rawServerLog = `
    [2026-07-26T21:00:00Z] INFO IP=192.168.1.15 session=sess_abc99 user=johndoe action=LOGIN
    [2026-07-26T21:01:15Z] WARN IP=10.0.0.99 session=sess_bad01 user=root action=BREACH_ATTEMPT
    [2026-07-26T21:02:30Z] INFO IP=192.168.1.15 session=sess_abc99 user=johndoe action=QUERY
  `;

  type LogGroups = {
    timestamp: string;
    level: string;
    ip: string;
    session: string;
    user: string;
    action: string;
  };

  const logPipeline = new FluentAsyncRegexPipeline<LogIngestMetrics>({
    totalEntries: 0,
    ipAccessCounts: {},
    activeSessions: new Set<string>(),
    threatDetections: []
  })
    .step<LogGroups>(
      /\[(?<timestamp>[^\]]+)\]\s+(?<level>\w+)\s+IP=(?<ip>[\d.]+)\s+session=(?<session>\w+)\s+user=(?<user>\w+)\s+action=(?<action>\w+)/g,
      async (acc, match) => {
        const { timestamp, ip, session, action } = match.groups!;
        
        acc.totalEntries++;
        acc.ipAccessCounts[ip] = (acc.ipAccessCounts[ip] || 0) + 1;
        acc.activeSessions.add(session);

        // Asynchronously check threat intel if action indicates risk or suspicious origin
        if (action === "BREACH_ATTEMPT" || ip.startsWith("10.0")) {
          const threatLevel = await lookupIpThreatLevel(ip);
          acc.threatDetections.push({ ip, threatLevel, timestamp });
        }

        return acc;
      }
    );

  const finalMetrics = await logPipeline.run(rawServerLog);
  // Convert Set to Array for clean JSON visualization
  console.log("Example 6 (Refactored Fluent Log Ingestion):", {
    ...finalMetrics,
    activeSessions: Array.from(finalMetrics.activeSessions)
  });
};

// 7. Refactored Composed Async Log Pipeline separating parsing from security auditing
const runRefactoredComposedLogPipeline = async () => {
  const securityLogStream = "SRC=192.168.1.50 EVT=AUTH_SUCCESS | SRC=10.0.4.12 EVT=UNAUTHORIZED_ACCESS";

  type AuditState = {
    eventsParsed: number;
    securityAlerts: string[];
  };

  const parseLogStep = asyncRegexStep<AuditState>(/SRC=(?<ip>[\d.]+)\s+EVT=(?<event>\w+)/g, async (acc, match) => {
    await new Promise((r) => setTimeout(r, 8));
    acc.eventsParsed++;
    return acc;
  });

  const auditThreatsStep = asyncRegexStep<AuditState>(/SRC=(?<ip>[\d.]+)\s+EVT=(?<event>\w+)/g, async (acc, match) => {
    await new Promise((r) => setTimeout(r, 10));
    const { ip, event } = match.groups!;
    const threatLevel = await lookupIpThreatLevel(ip);

    if (event === "UNAUTHORIZED_ACCESS" || threatLevel === "HIGH") {
      acc.securityAlerts.push(`Alert: IP ${ip} triggered security event ${event} with rating ${threatLevel}`);
    }
    return acc;
  });

  const composedAuditor = composeAsyncRegexPipelines(parseLogStep, auditThreatsStep);

  const auditResult = await composedAuditor(securityLogStream, {
    eventsParsed: 0,
    securityAlerts: []
  });

  console.log("Example 7 (Refactored Composed Log Pipeline):", auditResult);
};

// Execute refactored log pipeline examples
(async () => {
  await runRefactoredLogIngestPipeline();
  await runRefactoredComposedLogPipeline();
})();
