import { describe, it, expect, vi, beforeEach } from "vitest";
import { KyraGovernor } from "../governor";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

function mockDecision(outcome: string, extra: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      traceId: "t1",
      evaluationId: "e1",
      orgId: "org1",
      outcome,
      mode: "ENFORCE",
      tier: "T0",
      evaluationMs: 5,
      gateResults: [],
      ...extra,
    }),
  });
}

describe("KyraGovernor", () => {
  let governor: KyraGovernor;

  beforeEach(() => {
    governor = new KyraGovernor({ apiKey: "kyra_sk_test" });
    mockFetch.mockReset();
  });

  it("ALLOW outcome — returns ok true", async () => {
    mockDecision("ALLOW");
    const result = await governor.evaluate(
      "search_db",
      "Searches database",
      { query: "x" }
    );
    expect(result.ok).toBe(true);
    expect(result.blockReason).toBe("");
  });

  it("BLOCK outcome — returns ok false and blockReason", async () => {
    mockDecision("BLOCK", { blockReason: "Exceeds row limit" });
    const result = await governor.evaluate("bulk_delete", "Deletes records", { table: "orders" });
    expect(result.ok).toBe(false);
    expect(result.blockReason).toBe("Exceeds row limit");
  });

  it("RETURN_TO_USER outcome — returns ok false with missing params in blockReason", async () => {
    mockDecision("RETURN_TO_USER", { missingParameters: ["reason"] });
    const result = await governor.evaluate("delete_user", "Deletes user", { user_id: "123" });
    expect(result.ok).toBe(false);
    expect(result.blockReason).toContain("reason");
  });

  it("SHADOW mode — outcome ALLOW returns ok true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        traceId: "t1",
        evaluationId: "e1",
        orgId: "org1",
        outcome: "ALLOW",
        shadowOutcome: "BLOCK",
        mode: "SHADOW",
        tier: "T3",
        evaluationMs: 5,
        gateResults: [],
      }),
    });
    const result = await governor.evaluate("bulk_delete", "desc", {});
    expect(result.ok).toBe(true);
  });

  it("fail-open on timeout — returns ok true", async () => {
    const failOpenGovernor = new KyraGovernor({
      apiKey: "kyra_sk_test",
      serverUrl: "http://doesnotexist.invalid",
      timeoutMs: 10,
      failOpen: true,
    });
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error("abort"), { name: "AbortError" })
    );
    const result = await failOpenGovernor.evaluate("any_tool", "desc", {});
    expect(result.ok).toBe(true);
  });

  it("fail-closed on timeout — returns ok false with blockReason", async () => {
    const failClosedGovernor = new KyraGovernor({
      apiKey: "kyra_sk_test",
      failOpen: false,
    });
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error("abort"), { name: "AbortError" })
    );
    const result = await failClosedGovernor.evaluate("any_tool", "desc", {});
    expect(result.ok).toBe(false);
    expect(result.blockReason).toBeTruthy();
  });

  it("wrap() returns same number of tools as input", () => {
    const fakeTool = {
      name: "test",
      description: "test tool",
      invoke: vi.fn(),
    };
    const wrapped = governor.wrap([fakeTool as any, fakeTool as any]);
    expect(wrapped).toHaveLength(2);
  });

  it("correct wire format sent in POST body", async () => {
    mockDecision("ALLOW");
    await governor.evaluate("delete_record", "Deletes a record", { id: "42" });
    expect(mockFetch).toHaveBeenCalled();
    const call = mockFetch.mock.calls.find((c: any) => c[0]?.includes("/v1/evaluate"));
    expect(call).toBeDefined();
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.toolName).toBe("delete_record");
    expect(body.parameters).toEqual({ id: "42" });
    expect(body.framework).toBe("LANGCHAIN_JS");
    expect(body.sdkVersion).toBe("1.0.0");
    expect(body.governanceContext).toBeDefined();
  });

  it("wrap(tools, { framework: 'generic' }) sends GENERIC in evaluate", async () => {
    mockDecision("ALLOW");
    const genericTool = {
      name: "my_tool",
      description: "A generic tool",
      invoke: vi.fn().mockResolvedValue("ok"),
    };
    const wrapped = governor.wrap([genericTool], { framework: "generic" }) as any[];
    expect(wrapped).toHaveLength(1);
    await wrapped[0].invoke({ x: "y" });
    const call = mockFetch.mock.calls.find((c: any) => c[0]?.includes("/v1/evaluate"));
    expect(call).toBeDefined();
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.framework).toBe("GENERIC");
    expect(body.toolName).toBe("my_tool");
  });

  it("wrap(tools, { framework: 'langchain' }) returns [tools, callback]", () => {
    const tools = [
      { name: "a", description: "d", invoke: vi.fn(), _call: vi.fn() },
    ];
    const result = governor.wrap(tools, { framework: "langchain" }) as [any[], any];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0]).toHaveLength(1);
    expect(result[1]).toBeDefined();
  });

  it("wrap(toolNode, { framework: 'langgraph' }) returns KyraToolNode", () => {
    const fakeNode = { name: "tools", invoke: vi.fn() };
    const result = governor.wrap(fakeNode, { framework: "langgraph" }) as any;
    expect(result).toBeDefined();
    expect(result.name).toBe("tools");
  });
});
