import { startMcpServer } from '@loam/mcp';

/** Starts the same graph-aware MCP server exposed by the standalone package. */
export async function startMcpMode(graphRoot?: string): Promise<void> {
  await startMcpServer({ graphRoot });
}
