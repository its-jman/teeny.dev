import type {LanguageModelUsage, StepResult, StopCondition, ToolSet} from 'ai'
import type {ToolCallRecord, Usage} from '../../shared/api'
import type {ToolRecorder} from '../tools'

export type StrategyInput = {
	env: Env
	transcript: string
	model: string
	timezone: string
	recorder: ToolRecorder
}

export type StrategyOutput = {
	response: string
	usage: Usage
	/** Cost of everything except the transcription, when every model involved has a price. */
	costUsd: number | null
	llmMs: number
	routeMs: number | null
	meta: Record<string, unknown>
}

export function systemPrompt(timezone: string) {
	const now = new Date().toLocaleString('en-US', {
		timeZone: timezone,
		dateStyle: 'full',
		timeStyle: 'short',
	})
	return [
		'You are a voice assistant. The user spoke a command which was transcribed to text.',
		`It is currently ${now} (${timezone}).`,
		'Carry out the request using the available tools. If the user asks for several things, do all of them.',
		'If no tool fits, do not call any tool; reply briefly instead.',
		'After acting, reply with one short spoken-style sentence confirming what you did.',
	].join('\n')
}

export const toUsage = (u: LanguageModelUsage | undefined): Usage => ({
	inputTokens: u?.inputTokens ?? 0,
	outputTokens: u?.outputTokens ?? 0,
})

/**
 * Stop as soon as a step's tool calls all succeeded (voice wants low latency, not a
 * follow-up summary turn), but allow up to `max` steps so the model can recover from errors.
 */
export function stopAfterToolsSucceed<T extends ToolSet>(max = 3): StopCondition<T> {
	return ({steps}) => {
		const last = steps.at(-1) as StepResult<T> | undefined
		if (!last || steps.length >= max) return true
		if (last.toolCalls.length === 0) return true
		return !last.content.some((part) => part.type === 'tool-error')
	}
}

/** Model text if it produced any, otherwise a templated confirmation from the tool calls. */
export function responseText(text: string, calls: ToolCallRecord[]) {
	const trimmed = text.trim()
	if (trimmed) return trimmed
	if (calls.length === 0) return "Sorry, I can't help with that."
	return 'Done: ' + calls.map((c) => c.tool).join(', ')
}
