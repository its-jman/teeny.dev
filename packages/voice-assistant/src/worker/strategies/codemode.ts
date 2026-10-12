import {DynamicWorkerExecutor} from '@cloudflare/codemode'
import {createCodeTool} from '@cloudflare/codemode/ai'
import {generateText} from 'ai'
import {costUsd, getModel} from '../models'
import {aiSdkTools} from '../tools'
import {
	responseText,
	stopAfterToolsSucceed,
	systemPrompt,
	toUsage,
	type StrategyInput,
	type StrategyOutput,
} from './shared'

/**
 * Approach 3: Code Mode. The LLM sees one `codemode` tool whose description contains
 * TypeScript types for every stub tool, and writes a JS snippet that calls them. The snippet
 * runs in a fresh isolate from the Worker Loader binding; tool calls RPC back into this Worker.
 */
export async function runCodemode(input: StrategyInput): Promise<StrategyOutput> {
	const {model, def} = getModel(input.env, input.model)
	const executor = new DynamicWorkerExecutor({loader: input.env.LOADER})
	const codemode = createCodeTool({tools: aiSdkTools(input.recorder), executor})
	// Time the sandbox separately so the LLM latency isn't conflated with isolate startup.
	let sandboxMs = 0
	const execute = codemode.execute!
	codemode.execute = (async (args, opts) => {
		const start = performance.now()
		try {
			return await execute(args, opts)
		} finally {
			sandboxMs += performance.now() - start
		}
	}) as typeof execute

	const llmStart = performance.now()
	const result = await generateText({
		model,
		system: systemPrompt(input.timezone),
		prompt: input.transcript,
		tools: {codemode},
		stopWhen: stopAfterToolsSucceed(),
	})
	const llmMs = performance.now() - llmStart

	const code = result.steps.flatMap((s) =>
		s.toolCalls.map((c) => (c.input as {code?: string} | undefined)?.code)
	)
	const errors = result.steps.flatMap((s) =>
		s.content.filter((p) => p.type === 'tool-error').map((p) => String(p.error))
	)
	const usage = toUsage(result.totalUsage)
	return {
		response: responseText(result.text, input.recorder.calls),
		usage,
		costUsd: costUsd(def, usage),
		llmMs,
		routeMs: null,
		meta: {steps: result.steps.length, sandboxMs, code, codeErrors: errors},
	}
}
