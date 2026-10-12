import type {CommandResult, RunRow, Strategy, SummaryRow} from '../shared/api'

export type RunInsert = CommandResult & {
	source: 'rpc' | 'http' | 'eval'
	inputKind: 'audio' | 'text'
	evalId?: string
	evalCaseId?: string
	score?: number
}

export async function insertRun(db: D1Database, r: RunInsert) {
	await db
		.prepare(
			`INSERT INTO runs (id, created_at, source, eval_id, eval_case_id, strategy, model, input_kind,
				transcript, transcribe_ms, route_ms, llm_ms, tool_ms, total_ms, input_tokens, output_tokens,
				cost_usd, tool_calls, response, meta, error, score)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			r.runId,
			Date.now(),
			r.source,
			r.evalId ?? null,
			r.evalCaseId ?? null,
			r.strategy,
			r.model,
			r.inputKind,
			r.transcript,
			r.timings.transcribeMs,
			r.timings.routeMs,
			r.timings.llmMs,
			r.timings.toolMs,
			r.timings.totalMs,
			r.usage.inputTokens,
			r.usage.outputTokens,
			r.costUsd,
			JSON.stringify(r.toolCalls),
			r.response,
			JSON.stringify(r.meta),
			r.error,
			r.score ?? null
		)
		.run()
}

type DbRow = {
	id: string
	created_at: number
	source: string
	eval_id: string | null
	eval_case_id: string | null
	strategy: Strategy
	model: string
	input_kind: 'audio' | 'text'
	transcript: string
	total_ms: number
	route_ms: number | null
	llm_ms: number | null
	transcribe_ms: number | null
	cost_usd: number | null
	tool_calls: string
	response: string | null
	error: string | null
	score: number | null
}

export async function listRuns(
	db: D1Database,
	opts: {limit?: number; evalId?: string} = {}
) {
	const limit = Math.min(opts.limit ?? 50, 500)
	const stmt = opts.evalId
		? db
				.prepare('SELECT * FROM runs WHERE eval_id = ? ORDER BY created_at DESC LIMIT ?')
				.bind(opts.evalId, limit)
		: db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?').bind(limit)
	const {results} = await stmt.all<DbRow>()
	return results.map(
		(r): RunRow => ({
			id: r.id,
			createdAt: r.created_at,
			source: r.source,
			evalId: r.eval_id,
			evalCaseId: r.eval_case_id,
			strategy: r.strategy,
			model: r.model,
			inputKind: r.input_kind,
			transcript: r.transcript,
			totalMs: r.total_ms,
			routeMs: r.route_ms,
			llmMs: r.llm_ms,
			transcribeMs: r.transcribe_ms,
			costUsd: r.cost_usd,
			toolCalls: JSON.parse(r.tool_calls),
			response: r.response,
			error: r.error,
			score: r.score,
		})
	)
}

const percentile = (sorted: number[], p: number) =>
	sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0

const mean = (xs: number[]) =>
	xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

/** Per strategy × model aggregates. Percentiles are computed here since D1 has no percentile(). */
export async function summarize(
	db: D1Database,
	opts: {evalId?: string; sinceMs?: number} = {}
) {
	const where: string[] = []
	const binds: unknown[] = []
	if (opts.evalId) {
		where.push('eval_id = ?')
		binds.push(opts.evalId)
	}
	if (opts.sinceMs) {
		where.push('created_at >= ?')
		binds.push(opts.sinceMs)
	}
	const sql = `SELECT strategy, model, total_ms, score, cost_usd, error FROM runs
		${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 10000`
	const {results} = await db
		.prepare(sql)
		.bind(...binds)
		.all<{
			strategy: Strategy
			model: string
			total_ms: number
			score: number | null
			cost_usd: number | null
			error: string | null
		}>()

	const groups = new Map<string, typeof results>()
	for (const r of results) {
		const k = `${r.strategy}\u0000${r.model}`
		groups.set(k, [...(groups.get(k) ?? []), r])
	}
	return [...groups.values()]
		.map((rows): SummaryRow => {
			const ms = rows.map((r) => r.total_ms).sort((a, b) => a - b)
			const scores = rows.flatMap((r) => (r.score == null ? [] : [r.score]))
			const costs = rows.flatMap((r) => (r.cost_usd == null ? [] : [r.cost_usd]))
			return {
				strategy: rows[0]!.strategy,
				model: rows[0]!.model,
				runs: rows.length,
				errors: rows.filter((r) => r.error).length,
				avgScore: mean(scores),
				p50Ms: percentile(ms, 0.5),
				p90Ms: percentile(ms, 0.9),
				avgCostUsd: mean(costs),
			}
		})
		.sort((a, b) => a.strategy.localeCompare(b.strategy) || a.p50Ms - b.p50Ms)
}
