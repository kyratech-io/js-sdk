import type { KyraGovernor, KyraGovernorConfig } from "../governor";
import { KyraGovernor as Gov } from "../governor";

/**
 * Create a governed agent with optional Mem0 client.
 * Returns [wrappedTools, governor]. Use wrapped tools with your Mem0/LangChain agent.
 */
export function createGovernedAgent(
  tools: any[],
  config: KyraGovernorConfig,
  _mem0Client?: any
): [any[], KyraGovernor] {
  const governor = new Gov(config);
  const [wrappedTools] = governor.wrap(tools, { framework: "langchain" }) as [any[], any];
  return [wrappedTools, governor];
}
