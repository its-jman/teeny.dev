import {generateText} from 'ai'
import {TOOL_NAMES, type ToolName} from '../../shared/api'
import {costUsd, getModel} from '../models'
import {aiSdkTools, TOOLS} from '../tools'
import {
	responseText,
	stopAfterToolsSucceed,
	systemPrompt,
	toUsage,
	type StrategyInput,
	type StrategyOutput,
} from './shared'

export const DECISION_MODEL = '@cf/cloudflare/clef-flash'
/** Used when the decision model says the request is multi-step or it isn't confident. */
export const ESCALATION_MODEL = 'llama-3.3-70b'
const MIN_CONFIDENCE = 0.6
const MULTI_INTENT_THRESHOLD = 0.5
// developers.cloudflare.com/workers-ai/models/clef-flash (no output-token charge)
const CLEF_FLASH_INPUT_PER_M = 0.038

// Clef isn't in @cloudflare/workers-types yet. Shapes from the model's published schema.
type ClefQuestion =
	| {type: 'choice'; instructions: string; criteria: Record<string, string>}
	| {type: 'noul'; instructions: string}
type ClefAnswer =
	| {
			type: 'choice'
			choice: string
			probabilities: Record<string, number>
			confidence: number
	  }
	| {type: 'noul'; noul: number}
type ClefResponse = {
	model: string
	answers: Record<string, ClefAnswer>
	usage: {input_tokens: number; output_tokens: number}
}

const questions = {
	tool: {
		type: 'choice',
		instructions: 'Which single action best matches what the user asked for?',
		criteria: {
			...Object.fromEntries(TOOL_NAMES.map((name) => [name, TOOLS[name].description])),
			none: 'Small talk, a question, or anything none of the actions above can do',
		},
	},
	multi: {
		type: 'noul',
		instructions: 'Does the user ask for two or more separate actions?',
	},
} satisfies Record<string, ClefQuestion>

export type RouteDecision = {
	tool: ToolName | 'none'
	confidence: number
	multiIntent: number
	path: 'single-tool' | 'escalate' | 'no-tool'
}

async function route(env: Env, transcript: string) {
	const start = performance.now()
	const res = (await env.AI.run(
		DECISION_MODEL as keyof AiModels,
		{
			model: 'clef-flash',
			state: transcript,
			questions,
		} as never
	)) as unknown as ClefResponse
	const ms = performance.now() - start

	const tool = res.answers.tool
	const multi = res.answers.multi
	if (tool?.type !== 'choice' || multi?.type !== 'noul') {
		throw new Error(`Unexpected decision model response: ${JSON.stringify(res)}`)
	}
	const choice = tool.choice as RouteDecision['tool']
	const decision: RouteDecision = {
		tool: choice,
		confidence: tool.confidence,
		multiIntent: multi.noul,
		path:
			multi.noul >= MULTI_INTENT_THRESHOLD || tool.confidence < MIN_CONFIDENCE
				? 'escalate'
				: choice === 'none'
					? 'no-tool'
					: 'single-tool',
	}
	return {
		decision,
		ms,
		inputTokens: res.usage.input_tokens,
		probabilities: tool.probabilities,
	}
}

/**
 * Approach 1: a decision model (Clef-flash) classifies the request first, in one forward
 * pass. Confident single-action requests go to a small model that only sees that one tool;
 * multi-action or low-confidence requests escalate to a bigger model with every tool.
 */
export async function runDecision(input: StrategyInput): Promise<StrategyOutput> {
	const routed = await route(input.env, input.transcript)
	const {decision} = routed
	const routeCost = (routed.inputTokens * CLEF_FLASH_INPUT_PER_M) / 1e6

	const modelKey = decision.path === 'escalate' ? ESCALATION_MODEL : input.model
	const {model, def} = getModel(input.env, modelKey)
	const only = decision.path === 'single-tool' ? [decision.tool as ToolName] : undefined
	const tools = decision.path === 'no-tool' ? undefined : aiSdkTools(input.recorder, only)

	const llmStart = performance.now()
	const result = await generateText({
		model,
		system: systemPrompt(input.timezone),
		prompt: input.transcript,
		...(tools && {tools}),
		// Anthropic's current models reject forced tool choice; others benefit from it.
		...(only && def.provider !== 'anthropic' && {toolChoice: 'required' as const}),
		stopWhen: stopAfterToolsSucceed(),
	})
	const llmMs = performance.now() - llmStart
	const usage = toUsage(result.totalUsage)
	const llmCost = costUsd(def, usage)

	return {
		response: responseText(result.text, input.recorder.calls),
		usage: {
			inputTokens: usage.inputTokens + routed.inputTokens,
			outputTokens: usage.outputTokens,
		},
		costUsd: llmCost == null ? null : llmCost + routeCost,
		llmMs,
		routeMs: routed.ms,
		meta: {
			route: decision,
			usedModel: modelKey,
			probabilities: routed.probabilities,
			steps: result.steps.length,
		},
	}
}
