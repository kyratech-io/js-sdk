import { describe, it, expect } from "vitest";
import { GovernanceContext } from "../governance-context";

describe("GovernanceContext.fromAgentSpawn", () => {
  it("inherits session and intent and links to parent trace", () => {
    const parent = GovernanceContext.fromHumanMessage("Delete user 123", "parent-agent");
    const childAgentId = "child-agent";

    const child = GovernanceContext.fromAgentSpawn(parent, childAgentId);

    expect(child.parentTraceId).toBe(parent.traceId);
    expect(child.sessionId).toBe(parent.sessionId);
    expect(child.originalIntentVerbatim).toBe(parent.originalIntentVerbatim);
    expect(child.traceId).not.toBe(parent.traceId);
    expect(child.parentAgentId).toBe(childAgentId);
  });
});

