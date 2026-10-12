import type {CommandInput, CommandResult} from '../shared/api'
import {insertRun, type RunInsert} from './metrics'
import {DEFAULT_MODELS, strategies} from './strategies'
import {ToolRecorder} from './tools'
import {transcribeAudio} from './transcribe'

type RunOptions = Pick<RunInsert, 'source' | 'evalId' | 'evalCaseId'> & {
	scoreFn?: (r: CommandResult) => number
	waitUntil?: (p: Promise<unknown>) => void
}

/** Transcribe if needed, run the chosen strategy, time every phase, and record the run. */
export async function runCommand(
	env: Env,
	input: CommandInput,
	opts: RunOptions
): Promise<CommandResult> {
	const start = performance.now()
	const strategy = input.strategy ?? 'decision'
	const model = input.model ?? DEFAULT_MODELS[strategy]
	const recorder = new ToolRecorder()
	const inputKind = input.audio ? 'audio' : 'text'

	let transcript = input.text?.trim() ?? ''
	let transcribeMs: number | null = null
	const base = {runId: crypto.randomUUID(), strategy, model, toolCalls: recorder.calls}

	let result: CommandResult
	try {
		if (input.audio) {
			const t = await transcribeAudio(env, input.audio)
			transcript = t.text
			transcribeMs = t.ms
		}
		if (!transcript) throw new Error('Provide `text` or non-empty `audio`')

		const out = await strategies[strategy]({
			env,
			transcript,
			model,
			timezone: input.timezone ?? 'UTC',
			recorder,
		})
		result = {
			...base,
			transcript,
			response: out.response,
			timings: {
				transcribeMs,
				routeMs: out.routeMs,
				llmMs: out.llmMs,
				toolMs: recorder.totalMs,
				totalMs: performance.now() - start,
			},
			usage: out.usage,
			costUsd: out.costUsd,
			meta: {...out.meta, ...(input.device && {device: input.device})},
			error: null,
		}
	} catch (err) {
		result = {
			...base,
			transcript,
			response: '',
			timings: {
				transcribeMs,
				routeMs: null,
				llmMs: null,
				toolMs: recorder.totalMs,
				totalMs: performance.now() - start,
			},
			usage: {inputTokens: 0, outputTokens: 0},
			costUsd: null,
			meta: {},
			error: err instanceof Error ? err.message : String(err),
		}
	}

	const score = opts.scoreFn?.(result)
	const write = insertRun(env.DB, {
		...result,
		source: opts.source,
		inputKind,
		...(opts.evalId && {evalId: opts.evalId}),
		...(opts.evalCaseId && {evalCaseId: opts.evalCaseId}),
		...(score != null && {score}),
	}).catch((err) => console.error('failed to record run', err))
	if (opts.waitUntil) opts.waitUntil(write)
	else await write
	return result
}
