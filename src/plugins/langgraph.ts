import type { KyraGovernor } from "../governor";
import { ErrGovernanceBlock } from "../models";

/**
 * Wraps a LangGraph ToolNode with Kyra pre-execution enforcement.
 * Usage: tool_node = governor.wrapToolNode(ToolNode(tools))
 */
export class KyraToolNode {
  readonly name: string;

  constructor(
    private readonly toolNode: any,
    private readonly governor: KyraGovernor
  ) {
    this.name = (this.toolNode as any)?.name ?? "tools";
  }

  async invoke(state: Record<string, any>): Promise<Record<string, any>> {
    const messages = state.messages ?? [];
    const lastMessage = messages[messages.length - 1];

    if (lastMessage?.tool_calls) {
      for (const toolCall of lastMessage.tool_calls) {
        const { ok, blockReason } = await this.governor._evaluateBeforeCall(
          toolCall.name ?? "",
          "",
          toolCall.args ?? {},
          undefined,
          "LANGGRAPH"
        );
        if (!ok) throw new ErrGovernanceBlock(blockReason);
      }
    }

    const node = this.toolNode;
    let result: Record<string, any>;
    if (typeof node === "function") {
      result = await Promise.resolve(node(state));
    } else if (typeof (node as any).invoke === "function") {
      result = await (node as any).invoke(state);
    } else {
      result = state;
    }
    // Hook 4: record each tool result for agentTrace
    try {
      const messages = result?.messages ?? [];
      for (const msg of messages) {
        const name = (msg as any)?.name;
        const content = (msg as any)?.content ?? "";
        if (typeof name === "string" && name) {
          this.governor.Tracer.recordToolResult(
            name,
            String(content),
            0,
            true,
            this.governor.Tracer.nextSequence()
          );
        }
      }
    } catch {
      // swallow
    }
    return result;
  }
}
