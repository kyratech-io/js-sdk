## Kyra JavaScript SDK Integration – Function-by-function Guide (`@kyra/sdk`)

This guide explains the Kyra governance SDK for JavaScript/TypeScript in terms of the **functions and classes you actually call**, using a repeatable structure:

- **Function name**
- **How and where to use**
- **Code snippet / example**
- **Other relevant information**

It covers Node.js agents built with **LangChain.js**, **LangGraph**, **CrewAI**, **Alchemyst**, or any generic tool interface.

---

## High-level flow (what you do per agent)

Most JavaScript agents using Kyra follow this pattern:

1. Create a `KyraGovernor` with your API key, server URL, mode, etc.
2. (Optional but recommended) Register your agent and policies with `governor.registerAgent`.
3. Wrap your tools or nodes with `governor.wrap(...)` (framework-specific options available).
4. Create a `GovernanceContext` from the user’s initial message and run your agent inside `runWithContext(...)`.
5. Catch `ErrGovernanceBlock` when tool calls are blocked, escalated, or missing parameters.

The sections below walk the main APIs in that structure.

---

## Core configuration and setup

### `new KyraGovernor(config)`

- **Function name**: `new KyraGovernor(config: KyraGovernorConfig)`
- **How and where to use**:
  - Call once when your process or agent starts (e.g. in your server bootstrap or script entrypoint).
  - Reuse the same governor for multiple runs/sessions of the same agent.
- **Code snippet / example**:

```ts
import { KyraGovernor } from "@kyra/sdk";

const governor = new KyraGovernor({
  apiKey: process.env.Kyra_API_KEY!,              // required
  serverUrl: process.env.Kyra_SERVER_URL,         // default: https://api.kyratech.io
  timeoutMs: 5000,                                // default: 5000
  failOpen: true,                                 // default: true
  mode: "enforce",                                // "enforce" | "shadow" | "" (default/omit)
  agentId: "my-agent-v1",                         // optional, but recommended
  sessionIntent: "Refund a customer order",       // optional free-text description
  framework: "LANGCHAIN_JS",                      // default framework label when wrapping
});
```

- **Other relevant information**:
  - **`mode`**:
    - `"enforce"` → ENFORCE (blocks on policy failure).
    - `"shadow"` → SHADOW (evaluates but does not block; logs what would have happened).
    - Any other value (including `""`) is omitted and server default is used.
  - **`failOpen`**:
    - `true` (default): if Kyra is unreachable, evaluations **allow** by default.
    - `false`: if Kyra is unreachable, evaluations **block** (`ErrGovernanceBlock`).
  - **`agentId`**:
    - Used for escalation polling if you don’t call `registerAgent`.
    - If you do call `registerAgent`, the registered ID is used automatically.

---

## Wrapping tools and nodes

### `governor.wrap(input, options)`

- **Function name**: `governor.wrap(input, options?)`
- **How and where to use**:
  - Call after you have your tools or LangGraph `ToolNode` constructed.
  - Use the **wrapped** tools/nodes inside your agent instead of the raw ones.
- **Code snippet / example (LangChain.js with telemetry)**:

```ts
import { KyraGovernor } from "@kyra/sdk";

const governor = new KyraGovernor({ apiKey: process.env.Kyra_API_KEY! });

const [governedTools, kyraCallback] = governor.wrap(tools, {
  framework: "langchain",
});

// Use governedTools as your tools; pass kyraCallback into your Runnable/Agent callbacks
// e.g. callbacks: [kyraCallback]
```

- **Code snippet / example (generic tools only)**:

```ts
const governedTools = governor.wrap(tools, { framework: "generic" });
// or simply:
// const governedTools = governor.wrap(tools);
```

- **Code snippet / example (LangGraph ToolNode)**:

```ts
import { KyraGovernor, KyraToolNode } from "@kyra/sdk";
// import { ToolNode } from "@langchain/langgraph/prebuilt";

const governor = new KyraGovernor({ apiKey: process.env.Kyra_API_KEY! });
const toolNode = new ToolNode(tools);
const governedToolNode = governor.wrap(toolNode, { framework: "langgraph" });

// Use governedToolNode in your graph instead of the raw ToolNode
```

- **Other relevant information**:
  - `governor.wrap` is a **unified** API; behavior depends on `options.framework`:

    | `framework`            | `input`             | Return value                                   |
    |------------------------|---------------------|-----------------------------------------------|
    | `"langchain"`          | `tools[]`           | `[wrappedTools, KyraLangChainCallback]`        |
    | `"langgraph"`          | `ToolNode`          | `KyraToolNode`                                 |
    | `"crewai"`             | `tools[]`           | `wrappedTools[]`                               |
    | `"alchemyst"`          | `tools[]`           | `wrappedTools[]`                               |
    | `"generic"` / default  | `tools[]`           | `wrappedTools[]`                               |

  - For **LangChain.js**, the `KyraLangChainCallback` records LLM inputs/outputs, chosen tool rationale, and tool results for governance.
  - For **CrewAI / Alchemyst / generic**, any object with `name`, `description`, and `invoke` or `call` can be wrapped.

---

### `createGovernedAgent`

- **Function name**: `createGovernedAgent(tools, config, mem0Client?)`
- **How and where to use**:
  - Call when you want a Mem0-style helper that both creates a `KyraGovernor` and returns governed tools in one step.
  - Use primarily in LangChain-style agents that expect a tool array.
- **Code snippet / example**:

```ts
import { createGovernedAgent } from "@kyra/sdk";

const [governedTools, governor] = createGovernedAgent(
  tools,
  { apiKey: process.env.Kyra_API_KEY! },
  mem0Client // optional; not used by the SDK itself
);
```

- **Other relevant information**:
  - If you already have a `KyraGovernor`, prefer `governor.wrap(tools, { framework: "langchain" })` instead.

---

## Governance context (per run)

Governance context ties all tool calls in a run together and flows across async boundaries.

### `GovernanceContext.fromHumanMessage`

- **Function name**: `GovernanceContext.fromHumanMessage(intent: string, agentId: string)`
- **How and where to use**:
  - Call once at the start of a run, using the **first user message** and the agent ID.
  - Typically inside your HTTP handler, CLI command, or orchestration entrypoint.
- **Code snippet / example**:

```ts
import { GovernanceContext } from "@kyra/sdk";

const ctx = GovernanceContext.fromHumanMessage(
  "Issue a refund for order ORD-123 if policy allows",
  "my-agent-v1"
);
```

- **Other relevant information**:
  - Internally constructs a governance context with fields like trace ID, session ID, original intent text, and aggregate action counts.

---

### `runWithContext`

- **Function name**: `runWithContext(ctx: GovernanceContext, fn: () => Promise<any>)`
- **How and where to use**:
  - Wrap your entire agent execution in `runWithContext` so the governance context is available via `AsyncLocalStorage`.
  - Any wrapped tool call made inside `fn` automatically gets the correct context.
- **Code snippet / example**:

```ts
import { GovernanceContext, runWithContext } from "@kyra/sdk";

const ctx = GovernanceContext.fromHumanMessage("...", "my-agent-v1");

await runWithContext(ctx, async () => {
  // your agent execution here
  // all Kyra evaluations will share the same governance context
});
```

- **Other relevant information**:
  - You rarely need to read the context directly—just ensure you create it once and always run the agent inside `runWithContext`.

---

### `GovernanceContext.fromAgentSpawn`

- **Function name**: `GovernanceContext.fromAgentSpawn(parent: GovernanceContext, childAgentId: string)`
- **How and where to use**:
  - Use when an orchestrator agent spawns a **child agent** and you want Kyra to understand the parent/child relationship.
- **Code snippet / example**:

```ts
import { GovernanceContext, runWithContext } from "@kyra/sdk";

const parent = GovernanceContext.fromHumanMessage(
  "Refund order 123",
  "orchestrator-agent"
);

const child = GovernanceContext.fromAgentSpawn(parent, "refund-agent-v1");

await runWithContext(child, async () => {
  // Run the child agent here; Kyra will see parentTraceId/parentAgentId
});
```

- **Other relevant information**:
  - This ensures Kyra can apply policies or analysis that depend on the full chain of agents.

---

### `activateFetchInterceptor` / `deactivateFetchInterceptor`

- **Function names**:
  - `activateFetchInterceptor()`
  - `deactivateFetchInterceptor()`
- **How and where to use**:
  - Call inside `runWithContext` when you want Kyra trace/governance headers automatically attached to outbound `fetch` requests from your tools.
- **Code snippet / example**:

```ts
import {
  GovernanceContext,
  runWithContext,
  activateFetchInterceptor,
  deactivateFetchInterceptor,
} from "@kyra/sdk";

const ctx = GovernanceContext.fromHumanMessage("...", "my-agent-v1");

await runWithContext(ctx, async () => {
  activateFetchInterceptor();

  // any fetch() calls from here will include X-Kyra-Trace / X-Kyra-Governance / X-Kyra-Session
  const res = await fetch("https://example.com/api");

  deactivateFetchInterceptor(); // optional: restore original fetch
});
```

- **Other relevant information**:
  - Useful when downstream services also want to participate in Kyra’s governance/observability.

---

## Agent registration and policies

### `governor.registerAgent`

- **Function name**: `governor.registerAgent(agentId, systemPrompt, tools, policies?)`
- **How and where to use**:
  - Call once at startup (or on deploy), before running any agent sessions.
  - Recommended for production agents so Kyra knows your prompt, tool catalog, and explicit policies.
- **Code snippet / example**:

```ts
import { KyraGovernor, type ToolDefinition } from "@kyra/sdk";

const governor = new KyraGovernor({ apiKey: process.env.Kyra_API_KEY! });

const tools: ToolDefinition[] = [
  {
    name: "issue_refund",
    description: "Issue a refund via the payment gateway",
    parametersSchema: {
      type: "object",
      properties: {
        orderId: { type: "string" },
        amount: { type: "number" },
        type: { type: "string", enum: ["cash", "store_credit"] },
      },
      required: ["orderId", "amount"],
    },
    requestedTier: "T3",
  },
];

await governor.registerAgent(
  "refund-agent-v1",
  "You are a payment operations agent...",
  tools,
  [
    {
      policyId: "refundco-cash-only-v1",
      description: "Refunds must be cash only",
      appliesToTools: ["issue_refund", "issue_chargeback_response"], // multiple tools example
      condition: "params.type != cash",
      action: "BLOCK",
      tier: "T2",
    },
  ]
);
```

- **Other relevant information**:
  - **Policy fields**:
    - `policyId`: unique identifier.
    - `description`: human-readable summary.
    - `appliesToTools`: one or more tool names this policy applies to.
    - `condition`: expression evaluated on the request (params, agent, etc.).
    - `action`: usually `"BLOCK"` or `"ESCALATE"`.
    - `tier`: governance tier for this policy (`"T0"`–`"T4"`, see tiers below).

---

### Tool tier hinting (`requestedTier`) and tiers

- **Function / field names**:
  - `tool.requestedTier = "T3"`
  - `requestedTier` in `ToolDefinition`
  - `tier` in policy definitions
- **How and where to use**:
  - On **wrapped tools**: set `requestedTier` on the tool instance before wrapping.
  - On **registered tools**: include `requestedTier` inside the `ToolDefinition`.
  - On **policies**: set `tier` to reflect how sensitive the policy is.
- **Code snippet / example**:

```ts
// During registration
const tools: ToolDefinition[] = [
  {
    name: "issue_refund",
    description: "...",
    parametersSchema: { /* ... */ },
    requestedTier: "T3",
  },
];
```

- **Other relevant information**:
  - The Kyra server uses `max(llmClassifiedTier, requestedTier)` when deciding the tier for an action.
  - Typical tier meanings:
    - `T0`: read-only / informational actions (e.g. lookups).
    - `T1`: low-risk writes (e.g. updating non-critical metadata).
    - `T2`: medium-risk actions (e.g. reversible financial operations).
    - `T3`: high-risk actions (e.g. irreversible payments, chargebacks).
    - `T4`: very high-risk / critical controls (e.g. admin-only or production-wide changes).

---

## Error handling and escalation

### `ErrGovernanceBlock`

- **Function name**: `class ErrGovernanceBlock extends Error`
- **How and where to use**:
  - Thrown by **wrapped tools** when Kyra blocks or escalates a call, or requires returning to the user.
  - Catch it wherever you `invoke` or `call` a governed tool.
- **Code snippet / example**:

```ts
import { ErrGovernanceBlock } from "@kyra/sdk";

try {
  const result = await governedTools[0].invoke({ /* params */ });
} catch (err) {
  if (err instanceof ErrGovernanceBlock) {
    console.error("Governance blocked:", err.message);
    // Handle: ask user (RETURN_TO_USER), request approval (ESCALATE), or halt (BLOCK)
  } else {
    throw err;
  }
}
```

- **Other relevant information**:
  - Outcomes that produce an `ErrGovernanceBlock`:
    - `BLOCK` – policy violation or risk-based denial.
    - `ESCALATE` – human approval required; SDK posts escalation asynchronously.
    - `RETURN_TO_USER` – missing parameters; you should ask the user for more detail.
    - Fail-closed server errors when `failOpen: false`.

---

### `governor.evaluate` (advanced)

- **Function name**: `governor.evaluate(request: ActionRequest): Promise<{ ok: boolean; blockReason?: string }>`
- **How and where to use**:
  - Rarely needed—used when you want to call Kyra directly instead of via wrapped tools.
  - You are responsible for enforcing allow/block based on the result.
- **Code snippet / example**:

```ts
const decision = await governor.evaluate(/* ActionRequest */);

if (!decision.ok) {
  console.error("Blocked by Kyra:", decision.blockReason);
  // Do not perform the underlying action
}
```

- **Other relevant information**:
  - Typical results:
    - `{ ok: true, blockReason: "" }` on ALLOW (and in SHADOW mode, even if `shadowOutcome` would have blocked).
    - `{ ok: false, blockReason }` on BLOCK / ESCALATE / RETURN_TO_USER / fail-closed errors.

---

### Escalations (`ESCALATE`)

- **Functionality**: handled internally by the SDK; you only see `ErrGovernanceBlock` plus an escalation ID inside the decision.
- **How and where to use**:
  - When an action is escalated, your wrapped tool throws `ErrGovernanceBlock`. You should treat this as a **no-go** and follow your own human-approval flow.
- **Other relevant information**:
  - On `ESCALATE`, the SDK:
    1. Returns a block immediately (`ErrGovernanceBlock`).
    2. Posts details asynchronously to `POST /v1/escalations`.
    3. Runs a background poller (every ~30s) to fetch approved escalations, refresh graph rules, and mark escalations processed.
  - Ensure `agentId` is set (via config or `registerAgent`) so the poller can run.

---

## Install and troubleshooting

### Install

- **How and where to use**:
  - Install the SDK in your Node.js project via npm.
- **Code snippet / example**:

```bash
npm install @kyra/sdk
```

- **Other relevant information**:
  - If you use `framework: "langchain"` or LangChain-shaped tools, you also need `@langchain/core` as a peer dependency.

---

### Troubleshooting

- **“Everything is allowed even when server is down”**:
  - You likely have `failOpen: true` (default). Set `failOpen: false` in `KyraGovernor` config to fail closed.
- **Escalation poller not doing anything**:
  - Ensure the governor has an `agentId` (via `registerAgent()` or the constructor config).
- **No telemetry in Kyra decisions**:
  - Wrap with `framework: "langchain"` and pass the returned `KyraLangChainCallback` into your LangChain runnable / executor callbacks so `agentTrace` is populated.

