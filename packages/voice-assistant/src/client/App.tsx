import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {useRef, useState} from 'react'
import {
	STRATEGIES,
	type CommandResult,
	type EvalProgress,
	type EvalReport,
	type Strategy,
	type SummaryRow,
} from '../shared/api'
import {api, getToken, setToken} from './rpc'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const fmtMs = (ms: number | null | undefined) =>
	ms == null ? '–' : `${Math.round(ms)}ms`
const fmtUsd = (n: number | null | undefined) =>
	n == null ? '–' : `$${(n * 1000).toFixed(4)}/1k`

type Tab = 'try' | 'metrics' | 'eval'

export function App() {
	const [tab, setTab] = useState<Tab>('try')
	return (
		<main>
			<header>
				<h1>Voice Assistant Lab</h1>
				<nav>
					{(['try', 'metrics', 'eval'] as const).map((t) => (
						<button
							key={t}
							className={tab === t ? 'active' : ''}
							onClick={() => setTab(t)}
						>
							{t === 'try' ? 'Try it' : t === 'metrics' ? 'Metrics' : 'Eval'}
						</button>
					))}
				</nav>
				<TokenInput />
			</header>
			{tab === 'try' && <TryIt />}
			{tab === 'metrics' && <Metrics />}
			{tab === 'eval' && <Eval />}
		</main>
	)
}

function TokenInput() {
	const [value, setValue] = useState(getToken)
	return (
		<input
			className="token"
			type="password"
			placeholder="API token (optional)"
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onBlur={() => setToken(value)}
		/>
	)
}

function useModels() {
	return useQuery({queryKey: ['models'], queryFn: () => api().listModels()})
}

function ModelSelect(props: {
	value: string
	onChange: (v: string) => void
	allowDefault?: boolean
}) {
	const models = useModels()
	return (
		<select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
			{props.allowDefault && <option value="">default per strategy</option>}
			{models.data?.map((m) => (
				<option key={m.key} value={m.key} disabled={!m.available}>
					{m.label}
					{m.available ? '' : ' (no API key)'}
				</option>
			))}
		</select>
	)
}

// #region try it
function useRecorder() {
	const [recording, setRecording] = useState(false)
	const recorder = useRef<MediaRecorder | null>(null)
	const chunks = useRef<Blob[]>([])

	const start = async () => {
		const stream = await navigator.mediaDevices.getUserMedia({audio: true})
		const r = new MediaRecorder(stream)
		chunks.current = []
		r.ondataavailable = (e) => chunks.current.push(e.data)
		r.start()
		recorder.current = r
		setRecording(true)
	}

	const stop = () =>
		new Promise<Uint8Array>((resolve) => {
			const r = recorder.current!
			r.onstop = async () => {
				r.stream.getTracks().forEach((t) => t.stop())
				setRecording(false)
				const blob = new Blob(chunks.current, {type: r.mimeType})
				resolve(new Uint8Array(await blob.arrayBuffer()))
			}
			r.stop()
		})

	return {recording, start, stop}
}

type Mode = Strategy | 'compare'

function TryIt() {
	const queryClient = useQueryClient()
	const [text, setText] = useState('')
	const [mode, setMode] = useState<Mode>('compare')
	const [model, setModel] = useState('')
	const [transcription, setTranscription] = useState<{text: string; ms: number} | null>(
		null
	)
	const mic = useRecorder()

	const run = useMutation({
		mutationFn: async (input: {
			text?: string
			audio?: Uint8Array
		}): Promise<CommandResult[]> => {
			const stub = api()
			const common = {timezone, device: 'web', ...(model && {model})}
			setTranscription(null)
			if (mode !== 'compare') {
				return [await stub.command({...input, strategy: mode, ...common})]
			}
			if (input.audio) {
				// Cap'n Web promise pipelining: transcribe once and feed `.text` into all three
				// commands without waiting for a round trip in between.
				const t = stub.transcribe(input.audio)
				const results = await Promise.all(
					STRATEGIES.map((strategy) => stub.command({text: t.text, strategy, ...common}))
				)
				setTranscription(await t)
				return results
			}
			return Promise.all(
				STRATEGIES.map((strategy) => stub.command({...input, strategy, ...common}))
			)
		},
		onSettled: () => queryClient.invalidateQueries({queryKey: ['summary']}),
	})

	return (
		<section>
			<div className="row">
				<select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
					<option value="compare">Compare all three</option>
					{STRATEGIES.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
				<ModelSelect value={model} onChange={setModel} allowDefault />
			</div>
			<form
				className="row"
				onSubmit={(e) => {
					e.preventDefault()
					if (text.trim()) run.mutate({text})
				}}
			>
				<input
					className="grow"
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder="Turn on the kitchen light and set an alarm for 7am"
				/>
				<button type="submit" disabled={run.isPending}>
					Send text
				</button>
				<button
					type="button"
					className={mic.recording ? 'recording' : ''}
					disabled={run.isPending}
					onClick={async () => {
						if (!mic.recording) return mic.start()
						run.mutate({audio: await mic.stop()})
					}}
				>
					{mic.recording ? 'Stop & send' : 'Record'}
				</button>
			</form>
			{run.isPending && <p className="muted">Running…</p>}
			{run.error && <p className="error">{String(run.error)}</p>}
			{transcription && (
				<p className="muted">
					Heard “{transcription.text}” in {fmtMs(transcription.ms)}
				</p>
			)}
			<div className="cards">
				{run.data?.map((r) => (
					<ResultCard key={r.runId} result={r} />
				))}
			</div>
		</section>
	)
}

function ResultCard({result: r}: {result: CommandResult}) {
	return (
		<article className="card">
			<h3>
				{r.strategy} <span className="muted">· {r.model}</span>
			</h3>
			{r.error ? <p className="error">{r.error}</p> : <p>{r.response}</p>}
			<ul className="calls">
				{r.toolCalls.map((c, i) => (
					<li key={i}>
						<code>
							{c.tool}({JSON.stringify(c.args)})
						</code>
					</li>
				))}
			</ul>
			<dl>
				<dt>total</dt>
				<dd>{fmtMs(r.timings.totalMs)}</dd>
				{r.timings.transcribeMs != null && (
					<>
						<dt>transcribe</dt>
						<dd>{fmtMs(r.timings.transcribeMs)}</dd>
					</>
				)}
				{r.timings.routeMs != null && (
					<>
						<dt>route</dt>
						<dd>{fmtMs(r.timings.routeMs)}</dd>
					</>
				)}
				<dt>llm</dt>
				<dd>{fmtMs(r.timings.llmMs)}</dd>
				<dt>tokens</dt>
				<dd>
					{r.usage.inputTokens}/{r.usage.outputTokens}
				</dd>
				<dt>cost</dt>
				<dd>{fmtUsd(r.costUsd)}</dd>
			</dl>
			<details>
				<summary>meta</summary>
				<pre>{JSON.stringify(r.meta, null, 2)}</pre>
			</details>
		</article>
	)
}
// #endregion try it

// #region metrics
function SummaryTable({rows}: {rows: SummaryRow[]}) {
	return (
		<table>
			<thead>
				<tr>
					<th>strategy</th>
					<th>model</th>
					<th>runs</th>
					<th>errors</th>
					<th>avg score</th>
					<th>p50</th>
					<th>p90</th>
					<th>avg cost</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((r) => (
					<tr key={r.strategy + r.model}>
						<td>{r.strategy}</td>
						<td>{r.model}</td>
						<td>{r.runs}</td>
						<td>{r.errors}</td>
						<td>{r.avgScore == null ? '–' : r.avgScore.toFixed(2)}</td>
						<td>{fmtMs(r.p50Ms)}</td>
						<td>{fmtMs(r.p90Ms)}</td>
						<td>{fmtUsd(r.avgCostUsd)}</td>
					</tr>
				))}
			</tbody>
		</table>
	)
}

function Metrics() {
	const summary = useQuery({queryKey: ['summary'], queryFn: () => api().summary()})
	const runs = useQuery({queryKey: ['runs'], queryFn: () => api().listRuns({limit: 50})})
	return (
		<section>
			<h2>All runs by strategy × model</h2>
			{summary.data && <SummaryTable rows={summary.data} />}
			<h2>Recent runs</h2>
			<table>
				<thead>
					<tr>
						<th>when</th>
						<th>source</th>
						<th>strategy</th>
						<th>model</th>
						<th>transcript</th>
						<th>tools</th>
						<th>total</th>
						<th>score</th>
					</tr>
				</thead>
				<tbody>
					{runs.data?.map((r) => (
						<tr key={r.id} className={r.error ? 'error' : ''}>
							<td>{new Date(r.createdAt).toLocaleTimeString()}</td>
							<td>{r.source}</td>
							<td>{r.strategy}</td>
							<td>{r.model}</td>
							<td>{r.transcript}</td>
							<td>{r.error ?? r.toolCalls.map((c) => c.tool).join(', ')}</td>
							<td>{fmtMs(r.totalMs)}</td>
							<td>{r.score?.toFixed(2) ?? '–'}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	)
}
// #endregion metrics

// #region eval
function Eval() {
	const queryClient = useQueryClient()
	const cases = useQuery({queryKey: ['evalCases'], queryFn: () => api().evalCases()})
	const models = useModels()
	const [strategies, setStrategies] = useState<Strategy[]>([...STRATEGIES])
	const [picked, setPicked] = useState<string[]>([])
	const [progress, setProgress] = useState<EvalProgress | null>(null)

	const run = useMutation({
		mutationFn: (): Promise<EvalReport> => {
			setProgress(null)
			// Passing a function over Cap'n Web: the Worker calls it back as each run finishes.
			return api().runEval({strategies, ...(picked.length && {models: picked})}, (p) =>
				setProgress(p)
			)
		},
		onSettled: () => queryClient.invalidateQueries({queryKey: ['summary']}),
	})

	const toggle = <T,>(list: T[], v: T) =>
		list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

	return (
		<section>
			<p className="muted">
				{cases.data?.length ?? '…'} cases × {strategies.length} strategies ×{' '}
				{picked.length || 'default'} model(s). Leave models empty to use each strategy's
				default.
			</p>
			<fieldset>
				<legend>Strategies</legend>
				{STRATEGIES.map((s) => (
					<label key={s}>
						<input
							type="checkbox"
							checked={strategies.includes(s)}
							onChange={() => setStrategies(toggle(strategies, s))}
						/>
						{s}
					</label>
				))}
			</fieldset>
			<fieldset>
				<legend>Models</legend>
				{models.data?.map((m) => (
					<label key={m.key} className={m.available ? '' : 'muted'}>
						<input
							type="checkbox"
							disabled={!m.available}
							checked={picked.includes(m.key)}
							onChange={() => setPicked(toggle(picked, m.key))}
						/>
						{m.label}
					</label>
				))}
			</fieldset>
			<button
				disabled={run.isPending || strategies.length === 0}
				onClick={() => run.mutate()}
			>
				{run.isPending ? 'Running…' : 'Run eval'}
			</button>
			{progress && (
				<p>
					<progress value={progress.done} max={progress.total} /> {progress.done}/
					{progress.total} · last: {progress.last.caseId} {progress.last.strategy}/
					{progress.last.model} → {progress.last.score.toFixed(2)} in{' '}
					{fmtMs(progress.last.totalMs)}
				</p>
			)}
			{run.error && <p className="error">{String(run.error)}</p>}
			{run.data && (
				<>
					<h2>Results</h2>
					<SummaryTable rows={run.data.summary} />
				</>
			)}
		</section>
	)
}
// #endregion eval
