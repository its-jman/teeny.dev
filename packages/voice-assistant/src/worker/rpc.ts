import {RpcTarget} from 'capnweb'
import {
	STRATEGIES,
	type CommandInput,
	type EvalOptions,
	type EvalProgress,
	type EvalReport,
	type PublicApi,
} from '../shared/api'
import {runCommand} from './command'
import {EVAL_CASES} from './eval/cases'
import {scoreCase} from './eval/score'
import {listRuns, summarize} from './metrics'
import {listModels} from './models'
import {DEFAULT_MODELS} from './strategies'
import {transcribeAudio} from './transcribe'

/** The Cap'n Web API, served at /rpc over WebSocket or HTTP batch. */
export class VoiceApi extends RpcTarget implements PublicApi {
	#env: Env
	#ctx: ExecutionContext

	constructor(env: Env, ctx: ExecutionContext) {
		super()
		this.#env = env
		this.#ctx = ctx
	}

	async command(input: CommandInput) {
		return runCommand(this.#env, input, {
			source: 'rpc',
			waitUntil: (p) => this.#ctx.waitUntil(p),
		})
	}

	async transcribe(audio: Uint8Array) {
		return transcribeAudio(this.#env, audio)
	}

	async listModels() {
		return listModels(this.#env)
	}

	async listRuns(opts?: {limit?: number; evalId?: string}) {
		return listRuns(this.#env.DB, opts)
	}

	async summary(opts?: {evalId?: string; sinceMs?: number}) {
		return summarize(this.#env.DB, opts)
	}

	async evalCases() {
		return EVAL_CASES
	}

	async runEval(
		opts: EvalOptions,
		onProgress?: (p: EvalProgress) => void
	): Promise<EvalReport> {
		const evalId = crypto.randomUUID()
		const cases = opts.caseIds
			? EVAL_CASES.filter((c) => opts.caseIds!.includes(c.id))
			: EVAL_CASES
		const strategies = opts.strategies ?? [...STRATEGIES]
		const jobs = cases.flatMap((c) =>
			strategies.flatMap((strategy) =>
				(opts.models ?? [DEFAULT_MODELS[strategy]]).map((model) => ({c, strategy, model}))
			)
		)

		let done = 0
		let next = 0
		const worker = async () => {
			while (next < jobs.length) {
				const {c, strategy, model} = jobs[next++]!
				const result = await runCommand(
					this.#env,
					{text: c.text, strategy, model, timezone: 'America/Los_Angeles'},
					{
						source: 'eval',
						evalId,
						evalCaseId: c.id,
						scoreFn: (r) => (r.error ? 0 : scoreCase(c.expect, r.toolCalls)),
					}
				)
				done++
				// Fire and forget: a slow or disconnected client shouldn't stall the sweep.
				Promise.resolve(
					onProgress?.({
						done,
						total: jobs.length,
						last: {
							caseId: c.id,
							strategy,
							model,
							score: result.error ? 0 : scoreCase(c.expect, result.toolCalls),
							totalMs: result.timings.totalMs,
						},
					})
				).catch(() => {})
			}
		}
		await Promise.all(
			Array.from({length: Math.max(1, Math.min(opts.concurrency ?? 4, 8))}, worker)
		)
		return {evalId, summary: await summarize(this.#env.DB, {evalId})}
	}
}
