// Types shared by the Worker and any client. The Worker's `VoiceApi` RpcTarget implements
// `PublicApi`; clients call it through a Cap'n Web stub (`newWebSocketRpcSession<PublicApi>`).

export const STRATEGIES = ['decision', 'mcp', 'codemode'] as const
export type Strategy = (typeof STRATEGIES)[number]

export const TOOL_NAMES = [
	'create_alarm',
	'create_note',
	'create_reminder',
	'create_linear_ticket',
	'start_car_ac',
	'set_light',
] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export type CommandInput = {
	/** Already-transcribed text. Provide this or `audio`. */
	text?: string
	/** Raw audio bytes (webm/ogg/wav/mp3/m4a). Transcribed with Workers AI first. */
	audio?: Uint8Array
	strategy?: Strategy
	/** Model key from `listModels()`. For `decision` this is the argument-extraction model. */
	model?: string
	/** IANA timezone of the device, used to resolve "tomorrow at 7". */
	timezone?: string
	/** Free-form device label, stored with the run ("iphone-shortcut", "car", ...). */
	device?: string
}

export type ToolCallRecord = {
	tool: string
	args: Record<string, unknown>
	ms: number
	result: unknown
}

export type CommandResult = {
	runId: string
	strategy: Strategy
	model: string
	transcript: string
	response: string
	toolCalls: ToolCallRecord[]
	timings: Timings
	usage: Usage
	costUsd: number | null
	meta: Record<string, unknown>
	error: string | null
}

export type Timings = {
	transcribeMs: number | null
	routeMs: number | null
	llmMs: number | null
	toolMs: number
	totalMs: number
}

export type Usage = {inputTokens: number; outputTokens: number}

export type ModelInfo = {
	key: string
	label: string
	provider: 'workers-ai' | 'anthropic' | 'openai'
	available: boolean
	inputPerM: number | null
	outputPerM: number | null
}

export type RunRow = {
	id: string
	createdAt: number
	source: string
	evalId: string | null
	evalCaseId: string | null
	strategy: Strategy
	model: string
	inputKind: 'audio' | 'text'
	transcript: string
	totalMs: number
	routeMs: number | null
	llmMs: number | null
	transcribeMs: number | null
	costUsd: number | null
	toolCalls: ToolCallRecord[]
	response: string | null
	error: string | null
	score: number | null
}

export type SummaryRow = {
	strategy: Strategy
	model: string
	runs: number
	errors: number
	avgScore: number | null
	p50Ms: number
	p90Ms: number
	avgCostUsd: number | null
}

export type EvalCase = {
	id: string
	text: string
	/** Expected tool calls. Empty means the assistant should not call any tool. */
	expect: Array<{tool: ToolName; args?: Record<string, string | number | boolean>}>
}

export type EvalProgress = {
	done: number
	total: number
	last: {
		caseId: string
		strategy: Strategy
		model: string
		score: number
		totalMs: number
	}
}

export type EvalOptions = {
	strategies?: Strategy[]
	models?: string[]
	caseIds?: string[]
	/** How many runs in flight at once. Defaults to 4. */
	concurrency?: number
}

export type EvalReport = {
	evalId: string
	summary: SummaryRow[]
}

export interface PublicApi {
	command(input: CommandInput): Promise<CommandResult>
	/** Transcription alone. Pipeline its `.text` into several `command()` calls to compare strategies. */
	transcribe(audio: Uint8Array): Promise<{text: string; ms: number}>
	listModels(): Promise<ModelInfo[]>
	listRuns(opts?: {limit?: number; evalId?: string}): Promise<RunRow[]>
	summary(opts?: {evalId?: string; sinceMs?: number}): Promise<SummaryRow[]>
	evalCases(): Promise<EvalCase[]>
	/** Runs every case × strategy × model. `onProgress` is a client callback invoked over RPC. */
	runEval(opts: EvalOptions, onProgress?: (p: EvalProgress) => void): Promise<EvalReport>
}
