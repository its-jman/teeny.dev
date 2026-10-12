import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {newWorkersRpcResponse} from 'capnweb'
import {Hono} from 'hono'
import {createMiddleware} from 'hono/factory'
import {STRATEGIES, type CommandInput, type Strategy} from '../shared/api'
import {runCommand} from './command'
import {createMcpServer} from './mcp-server'
import {listRuns, summarize} from './metrics'
import {listModels} from './models'
import {VoiceApi} from './rpc'
import {ToolRecorder} from './tools'

const app = new Hono<{Bindings: Env}>()

// Optional shared-secret auth. Browsers can't set headers on WebSockets, so ?token= works too.
const auth = createMiddleware<{Bindings: Env}>(async (c, next) => {
	const token = c.env.API_TOKEN
	if (!token) return next()
	const given =
		c.req.query('token') ?? c.req.header('authorization')?.replace(/^Bearer /i, '')
	if (given !== token) return c.json({error: 'unauthorized'}, 401)
	return next()
})
app.use('/rpc', auth)
app.use('/api/*', auth)
app.use('/mcp', auth)

// Cap'n Web: WebSocket upgrade or HTTP batch, same endpoint.
app.all('/rpc', (c) =>
	newWorkersRpcResponse(
		c.req.raw,
		new VoiceApi(c.env, c.executionCtx as ExecutionContext)
	)
)

// Plain HTTP for devices that can't speak Cap'n Web (Shortcuts, ESP32, curl). Accepts
//   - application/json: CommandInput minus `audio`
//   - multipart/form-data: `audio` file plus optional text fields
//   - audio/*: raw body, options in the query string
app.post('/api/command', async (c) => {
	const type = c.req.header('content-type') ?? ''
	const q = c.req.query()
	let input: CommandInput
	if (type.startsWith('application/json')) {
		input = await c.req.json<CommandInput>()
	} else if (type.startsWith('multipart/form-data')) {
		const form = await c.req.formData()
		const audio = form.get('audio')
		input = {
			...(typeof form.get('text') === 'string' && {text: form.get('text') as string}),
			...(audio instanceof File && {audio: new Uint8Array(await audio.arrayBuffer())}),
			...(form.get('strategy') && {strategy: form.get('strategy') as Strategy}),
			...(form.get('model') && {model: form.get('model') as string}),
			...(form.get('timezone') && {timezone: form.get('timezone') as string}),
			...(form.get('device') && {device: form.get('device') as string}),
		}
	} else if (type.startsWith('audio/') || type === 'application/octet-stream') {
		input = {audio: new Uint8Array(await c.req.arrayBuffer())}
	} else {
		return c.json({error: `Unsupported content-type: ${type}`}, 415)
	}
	input = {
		...input,
		...(q.strategy && {strategy: q.strategy as Strategy}),
		...(q.model && {model: q.model}),
		...(q.timezone && {timezone: q.timezone}),
		...(q.device && {device: q.device}),
	}
	if (input.strategy && !STRATEGIES.includes(input.strategy)) {
		return c.json({error: `strategy must be one of ${STRATEGIES.join(', ')}`}, 400)
	}
	const result = await runCommand(c.env, input, {
		source: 'http',
		waitUntil: (p) => c.executionCtx.waitUntil(p),
	})
	return c.json(result, result.error ? 422 : 200)
})

app.get('/api/models', (c) => c.json(listModels(c.env)))
app.get('/api/runs', async (c) =>
	c.json(
		await listRuns(c.env.DB, {
			limit: Number(c.req.query('limit') ?? 50),
			...(c.req.query('evalId') && {evalId: c.req.query('evalId')!}),
		})
	)
)
app.get('/api/summary', async (c) =>
	c.json(
		await summarize(c.env.DB, {
			...(c.req.query('evalId') && {evalId: c.req.query('evalId')!}),
		})
	)
)

// The stub tools as a remote MCP server (stateless Streamable HTTP), so other agents and
// MCP clients can drive the same tools. Calls made here aren't recorded as runs.
app.all('/mcp', async (c) => {
	const server = createMcpServer(new ToolRecorder())
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	})
	await server.connect(transport)
	return transport.handleRequest(c.req.raw)
})

export default app
