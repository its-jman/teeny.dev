import type {EvalCase, ToolCallRecord} from '../../shared/api'

const normalizeTime = (s: string) => {
	const m = /^(\d{1,2}):(\d{2})/.exec(s.trim())
	return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : s
}

export function argMatches(
	expected: string | number | boolean,
	actual: unknown
): boolean {
	if (typeof expected === 'number') return Number(actual) === expected
	if (typeof expected === 'boolean')
		return actual === expected || String(actual) === String(expected)
	if (typeof actual !== 'string') return false
	const e = normalizeTime(expected).toLowerCase()
	const a = normalizeTime(actual).toLowerCase()
	return a.includes(e) || e.includes(a)
}

function callScore(expected: EvalCase['expect'][number], actual: ToolCallRecord) {
	const keys = Object.entries(expected.args ?? {})
	if (keys.length === 0) return 1
	const hits = keys.filter(([k, v]) => argMatches(v, actual.args[k])).length
	// Right tool is worth half; the other half is the fraction of expected args that match.
	return 0.5 + (0.5 * hits) / keys.length
}

/**
 * 0..1. Each expected call is greedily paired with the best unused actual call of the same
 * tool. Dividing by max(expected, actual) penalizes both missing and extra calls.
 */
export function scoreCase(expect: EvalCase['expect'], calls: ToolCallRecord[]): number {
	if (expect.length === 0) return calls.length === 0 ? 1 : 0
	const unused = [...calls]
	let total = 0
	for (const e of expect) {
		let best = -1
		let bestScore = 0
		unused.forEach((c, i) => {
			if (c.tool !== e.tool) return
			const s = callScore(e, c)
			if (s > bestScore) [best, bestScore] = [i, s]
		})
		if (best >= 0) {
			total += bestScore
			unused.splice(best, 1)
		}
	}
	return total / Math.max(expect.length, calls.length)
}
