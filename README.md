# @kyra/sdk

Runtime governance for AI agent actions in JavaScript/TypeScript (LangChain.js, LangGraph). Every tool call is evaluated by Kyra before execution; blocked actions throw `ErrGovernanceBlock` so your agent can respond safely.

---

## Install

```bash
npm install @kyra/sdk
```

---

## Quick start

```typescript
import {
  KyraGovernor,
  GovernanceContext,
  runWithContext,
  ErrGovernanceBlock,
} from "@kyra/sdk";

// 1. Create governor (once per process or per agent)
const governor = new KyraGovernor({
  apiKey: "kyra_sk_...",
  agentId: "my-agent-v1",
  failOpen: false,
});

// 2. Wrap your tools
const tools = [searchTool, refundTool];
const governedTools = governor.wrap(tools);

// 3. For each run: create governance context and run agent within it
const ctx = GovernanceContext.fromHumanMessage(
  "Refund order 123 if policy allows",
  "my-agent-v1"
);

const result = runWithContext(ctx, () => {
  // Run your agent with governedTools inside this callback
  return agent.invoke({ input: "Refund order 123" });
});

// Or with async:
const resultAsync = await runWithContext(ctx, async () => {
  try {
    return await governedTools[0].invoke({ orderId: "123", amount: 50 });
  } catch (e) {
    if (e instanceof ErrGovernanceBlock) {
      console.log("Blocked by policy:", e.msg);
    }
    throw e;
  }
});
```

---

## Configuration

Create the governor with `KyraGovernorConfig`:

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `apiKey` | Yes | — | Your Kyra API key (`kyra_sk_...`) |
| `timeoutMs` | No | 5000 | Request timeout in milliseconds |
| `failOpen` | No | `true` | If true, allow tool execution when Kyra is unreachable |
| `mode` | No | `""` | `"enforce"` or `"shadow"` — sent to server as ENFORCE / SHADOW |
| `agentId` | No | `""` | Agent identifier for evaluate requests |
| `sessionIntent` | No | `""` | Optional session-level intent hint |
| `framework` | No | `"LANGCHAIN_JS"` | Reported in wire format |

**Example (fail-closed, enforce mode):**

```typescript
const governor = new KyraGovernor({
  apiKey: process.env.KYRA_API_KEY!,
  agentId: "refund-agent-v1",
  failOpen: false,
  mode: "enforce",
});
```

---

## Wrapping tools

Call `governor.wrap(tools)` (or `governor.wrap(tools, { framework: "..." })`) and use the returned tools in your agent so every invocation is evaluated by Kyra.

### Generic (default)

```typescript
const governedTools = governor.wrap(tools);
// Array of governed tools; use in any agent framework
```

### LangChain

Returns `[governedTools, callback]`. Pass the callback to `AgentExecutor` so LLM and tool activity are recorded for Kyra:

```typescript
const [governedTools, callback] = governor.wrap(tools, { framework: "langchain" });
const executor = new AgentExecutor({
  agent,
  tools: governedTools,
  callbacks: [callback],
});
```

### LangGraph

Pass your tool node; returns a governed `KyraToolNode`:

```typescript
const governedToolNode = governor.wrap(toolNode, { framework: "langgraph" });
// Use governedToolNode in your graph
```

### CrewAI / Alchemyst

```typescript
const governedTools = governor.wrap(tools, { framework: "crewai" });
```

---

## Governance context (per run)

Set a governance context for each run so Kyra can associate all tool evaluations with the same trace and session. **Trace ID** can be user-provided (e.g. from your context) or omitted so Kyra auto-generates it; the decision returned from each evaluate always includes the trace ID used.

### From user message and runWithContext

```typescript
import { GovernanceContext, runWithContext, getContext } from "@kyra/sdk";

const ctx = GovernanceContext.fromHumanMessage(
  "Refund order 123 if policy allows",
  "refund-agent-v1"
);

runWithContext(ctx, () => {
  // All code inside this callback (and any async work it triggers) sees this context
  return myAgent.invoke({ input: "..." });
});

// getContext() returns the current context when called inside a runWithContext (or async continuation)
const current = getContext();
if (current) {
  console.log("Trace ID:", current.traceId, "Session ID:", current.sessionId);
}
```

### From agent spawn (multi-agent)

When an orchestrator delegates to a sub-agent, create a child context so Kyra can link traces:

```typescript
const parent = GovernanceContext.fromHumanMessage(
  "Refund order 123",
  "orchestrator-agent"
);
const child = GovernanceContext.fromAgentSpawn(parent, "refund-agent-v1");

runWithContext(child, () => {
  return refundAgent.invoke(...);
});
```

---

## Agent registration (optional)

Register your agent with Kyra so evaluate requests are associated with a known agent:

```typescript
const agentId = await governor.registerAgent(
  "Refund Agent",
  systemPrompt,
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersSchema: t.schema ?? {},
  }))
);
// agentId is stored on the governor and used for subsequent evaluate calls
```

---

## Error handling

When Kyra blocks an action, governed tools throw **`ErrGovernanceBlock`**:

```typescript
import { ErrGovernanceBlock } from "@kyra/sdk";

try {
  const result = await governedTool.invoke(params);
} catch (e) {
  if (e instanceof ErrGovernanceBlock) {
    console.log("Blocked by policy:", e.msg);
    // e.msg is safe to log or show to users
    return;
  }
  throw e;
}
```

### Exception hierarchy

For finer handling you can catch specific Kyra errors:

```typescript
import {
  KyraBlockedException,
  KyraEscalationDeniedException,
  KyraReturnToUserException,
  KyraServerUnavailableException,
} from "@kyra/sdk";

try {
  await governedTool.invoke(params);
} catch (e) {
  if (e instanceof KyraReturnToUserException) {
    console.log("Missing parameters:", e.missingParameters);
  } else if (e instanceof KyraBlockedException) {
    console.log("Action blocked by policy");
  } else if (e instanceof KyraServerUnavailableException) {
    console.log("Kyra server unreachable");
  }
}
```

---

## Fetch interceptor (optional)

For automatic LLM/memory audit telemetry, activate the fetch interceptor so HTTP calls to known LLM and memory endpoints are reported to Kyra:

```typescript
import { activateFetchInterceptor, deactivateFetchInterceptor } from "@kyra/sdk";

activateFetchInterceptor();
// ... run your agent (fetch calls are intercepted)
deactivateFetchInterceptor();
```

The governor configures endpoints automatically when created; this is for advanced use.

---

## Build and test

```bash
npm install
npm run build
npm test
```

---

## Summary

| Step | What to do |
|------|------------|
| 1 | Create `new KyraGovernor({ apiKey, agentId, failOpen, ... })` |
| 2 | Wrap tools with `governor.wrap(tools)` or `governor.wrap(tools, { framework: "langchain" })` |
| 3 | For each run: `ctx = GovernanceContext.fromHumanMessage(msg, rootAgentId)` and `runWithContext(ctx, () => { ... })` |
| 4 | Run your agent with the governed tools inside the callback |
| 5 | Catch `ErrGovernanceBlock` when an action is blocked |

Optional: call `registerAgent()` at startup, and use `GovernanceContext.fromAgentSpawn(parent, childAgentId)` when delegating from an orchestrator to a sub-agent.
