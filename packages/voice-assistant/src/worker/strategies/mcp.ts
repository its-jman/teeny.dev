import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {dynamicTool, generateText, jsonSchema, type JSONSchema7, type ToolSet} from 'ai'
import {createMcpServer} from '../mcp-server'
import {costUsd, getModel} from '../models'
import {
	responseText,
	stopAfterToolsSucceed,
	systemPrompt,
	toUsage,
	type StrategyInput,
	type StrategyOutput,
} from './shared'

/**
 * Approach 2: one LLM, tools discovered over MCP. The MCP server runs in-process over a
 * linked in-memory transport so the measured overhead is the protocol, not the network.
 * Swap the transport for StreamableHTTPClientTransport to point at remote MCP servers.
 */
export async function runMcp(input: StrategyInput): Promise<StrategyOutput> {
	const {model, def} = getModel(input.env, input.model)

	const setupStart = performance.now()
	const server = createMcpServer(input.recorder)
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	const client = new Client({name: 'voice-assistant', version: '0.0.0'})
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
	const {tools: mcpTools} = await client.listTools()
	const tools: ToolSet = Object.fromEntries(
		mcpTools.map((t) => [
			t.name,
			dynamicTool({
				description: t.description ?? '',
				inputSchema: jsonSchema(t.inputSchema as JSONSchema7),
				execute: async (args) => {
					const res = await client.callTool({
						name: t.name,
						arguments: args as Record<string, unknown>,
					})
					if (res.isError) throw new Error(JSON.stringify(res.content))
					return res.content
				},
			}),
		])
	)
	const mcpSetupMs = performance.now() - setupStart

	try {
		const llmStart = performance.now()
		const result = await generateText({
			model,
			system: systemPrompt(input.timezone),
			prompt: input.transcript,
			tools,
			stopWhen: stopAfterToolsSucceed(),
		})
		const llmMs = performance.now() - llmStart
		const usage = toUsage(result.totalUsage)
		return {
			response: responseText(result.text, input.recorder.calls),
			usage,
			costUsd: costUsd(def, usage),
			llmMs,
			routeMs: null,
			meta: {mcpSetupMs, steps: result.steps.length, mcpToolCount: mcpTools.length},
		}
	} finally {
		await client.close()
		await server.close()
	}
}
