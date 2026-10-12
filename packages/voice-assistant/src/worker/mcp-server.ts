import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {TOOLS, type ToolRecorder} from './tools'

/** An MCP server exposing the stub tools. Used in-process by the `mcp` strategy and at /mcp. */
export function createMcpServer(recorder: ToolRecorder) {
	const server = new McpServer({name: 'voice-assistant-tools', version: '0.0.0'})
	for (const [name, t] of Object.entries(TOOLS)) {
		server.registerTool(
			name,
			{description: t.description, inputSchema: t.schema.shape},
			async (args: unknown) => {
				const result = await recorder.run(name, args)
				return {content: [{type: 'text' as const, text: JSON.stringify(result)}]}
			}
		)
	}
	return server
}
