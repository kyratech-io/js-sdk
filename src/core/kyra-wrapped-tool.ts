import type { StructuredTool } from "@langchain/core/tools";
import type { KyraGovernor } from "../governor";
import { ErrGovernanceBlock } from "../models";

export class KyraWrappedTool {
  private readonly frameworkWire: string | undefined;

  // Proxy pattern — forward all property access to wrapped tool
  constructor(
    private readonly tool: StructuredTool,
    private readonly governor: KyraGovernor,
    frameworkWire?: string
  ) {
    this.frameworkWire = frameworkWire;
    return new Proxy(this, {
      get(target, prop) {
        if (prop === "_call" || prop === "invoke")
          return target[prop as keyof typeof target];
        if (prop in target) return target[prop as keyof typeof target];
        const val = (tool as any)[prop];
        return typeof val === "function" ? val.bind(tool) : val;
      },
    });
  }

  get name() {
    return this.tool.name;
  }
  get description() {
    return this.tool.description;
  }
  get schema() {
    return (this.tool as any).schema;
  }

  async invoke(input: Record<string, unknown>, config?: any): Promise<any> {
    const requestedTier = (this.tool as any).requestedTier;
    const { ok, blockReason } = await this.governor._evaluateBeforeCall(
      this.tool.name,
      this.tool.description,
      input,
      requestedTier,
      this.frameworkWire
    );
    if (!ok) throw new ErrGovernanceBlock(blockReason);
    const start = Date.now();
    try {
      const result = await this.tool.invoke(input, config);
      const executionTimeMs = Date.now() - start;
      this.governor.Tracer.recordToolResult(
        this.tool.name,
        String(result),
        executionTimeMs,
        true,
        this.governor.Tracer.nextSequence()
      );
      return result;
    } catch (e) {
      const executionTimeMs = Date.now() - start;
      this.governor.Tracer.recordToolResult(
        this.tool.name,
        "",
        executionTimeMs,
        false,
        this.governor.Tracer.nextSequence()
      );
      throw e;
    }
  }

  async _call(input: Record<string, unknown>): Promise<string> {
    const requestedTier = (this.tool as any).requestedTier;
    const { ok, blockReason } = await this.governor._evaluateBeforeCall(
      this.tool.name,
      this.tool.description,
      input,
      requestedTier,
      this.frameworkWire
    );
    if (!ok) throw new ErrGovernanceBlock(blockReason);
    const start = Date.now();
    try {
      const result = await (this.tool as any)._call(input);
      const executionTimeMs = Date.now() - start;
      this.governor.Tracer.recordToolResult(
        this.tool.name,
        String(result),
        executionTimeMs,
        true,
        this.governor.Tracer.nextSequence()
      );
      return result;
    } catch (e) {
      const executionTimeMs = Date.now() - start;
      this.governor.Tracer.recordToolResult(
        this.tool.name,
        "",
        executionTimeMs,
        false,
        this.governor.Tracer.nextSequence()
      );
      throw e;
    }
  }
}
