# voice-assistant

A Cloudflare Worker (Hono + React) that takes a voice command, as audio or already-transcribed
text, and turns it into tool calls. It exists to compare three ways of picking and calling
tools on **latency, cost and accuracy**:

| Strategy   | How it works                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decision` | Cloudflare's decision model (`@cf/cloudflare/clef-flash`) classifies the request in one forward pass: which tool, and is it multi-action? Confident single-tool requests go to a small model that only sees that one tool. Multi-action or low-confidence requests escalate to a bigger model with every tool. Thresholds live in `src/worker/strategies/decision.ts`. |
| `mcp`      | One LLM, with the tools discovered from an MCP server (`listTools` / `callTool`). The server runs in-process over a linked in-memory transport, so what is measured is MCP overhead, not network. Pick any model to compare price and accuracy.                                                                                                                        |
| `codemode` | [Code Mode](https://developers.cloudflare.com/agents/api-reference/codemode): the LLM gets one `codemode` tool typed with every stub tool, writes a JS snippet, and the snippet runs in a fresh isolate from a Worker Loader binding.                                                                                                                                  |

Tools (all **stubs** that validate, record the call and return a fake result, see
`src/worker/tools.ts`): `create_alarm`, `create_note`, `create_reminder`,
`create_linear_ticket`, `start_car_ac`, `set_light`.

## Setup

```sh
npm install                                   # from the repo root
cd packages/voice-assistant
npx wrangler d1 create voice-assistant        # paste the id into wrangler.jsonc
npm run db:migrate:local                      # and `npm run db:migrate` for remote
npm run dev                                   # Vite + Workers runtime
npm run deploy
```

`npm run dev` needs `wrangler login` (or `CLOUDFLARE_API_TOKEN`) because the Workers AI binding
always runs remotely. Optional secrets, in `.dev.vars` locally or via `wrangler secret put`:

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` to enable those models (Workers AI models need nothing).
- `API_TOKEN` to require `Authorization: Bearer <token>` (or `?token=`) on `/rpc`, `/api/*` and `/mcp`.

## Calling it

**Cap'n Web** (`/rpc`, WebSocket or HTTP batch). Types are in `src/shared/api.ts`:

```ts
import {newWebSocketRpcSession} from 'capnweb'
import type {PublicApi} from './src/shared/api'

using api = newWebSocketRpcSession<PublicApi>(
	'wss://voice-assistant.<you>.workers.dev/rpc'
)
const r = await api.command({text: 'turn on the kitchen light', strategy: 'codemode'})
// or: api.command({audio: new Uint8Array(await blob.arrayBuffer()), strategy: 'decision'})
```

**Plain HTTP** for devices that can't run JS (Shortcuts, ESP32, curl):

```sh
# text
curl -X POST $URL/api/command -H 'content-type: application/json' \
  -d '{"text":"set an alarm for 6:45","strategy":"mcp","model":"claude-haiku"}'
# raw audio body, options in the query string
curl -X POST "$URL/api/command?strategy=decision&timezone=America/New_York" \
  -H 'content-type: audio/webm' --data-binary @command.webm
# multipart: audio file + fields
curl -X POST $URL/api/command -F audio=@command.m4a -F strategy=codemode
```

**MCP**: `/mcp` serves the same stub tools as a stateless Streamable HTTP MCP server.

Audio is transcribed with `@cf/openai/whisper-large-v3-turbo` before the strategy runs.

## Metrics

Every command, from any client, is written to the D1 `runs` table with per-phase timings
(`transcribe_ms`, `route_ms`, `llm_ms`, `tool_ms`, `total_ms`), tokens, estimated cost, the
tool calls and strategy-specific `meta` (route decision and probabilities, generated code,
sandbox time, MCP setup time, step count). The web UI's **Metrics** tab and
`GET /api/summary` aggregate by strategy × model (runs, errors, avg score, p50/p90, avg cost).

Cost uses the per-model prices in `src/worker/models.ts` (Workers AI pricing page and
Anthropic list prices as of 2026-10-12). Models added ad hoc as `openai:<id>`, `anthropic:<id>`
or `wai:@cf/<id>` have no price and report `null` cost.

## Quality: the eval set

`src/worker/eval/cases.ts` has 20 utterances with expected tool calls, including multi-action
requests, no-tool requests and filler words. `src/worker/eval/score.ts` scores each run 0–1
(right tool earns half, matching expected args the other half; missing and extra calls
are penalized). Run a sweep from the **Eval** tab, or over RPC:

```ts
await api.runEval(
	{
		strategies: ['decision', 'mcp', 'codemode'],
		models: ['llama-3.3-70b', 'claude-haiku'],
	},
	(p) => console.log(`${p.done}/${p.total}`)
)
```

The progress callback is a plain function passed over Cap'n Web; the Worker calls it back.

## Cap'n Web: verdict

It works, and it was the least effortful part of the project. What was verified locally
(Workers runtime via the Vite plugin, a Node client and the React client):

- `newWorkersRpcResponse(c.req.raw, new VoiceApi(...))` inside a Hono route serves both
  WebSocket and HTTP-batch clients from one `/rpc` endpoint. No schema, no codegen; the client
  just imports the `PublicApi` interface.
- `Uint8Array` audio goes over RPC as-is, so there's no base64 or multipart handling.
- Passing a callback (`runEval(opts, onProgress)`) works: the server invokes it once per run.
- Promise pipelining is typed: the UI's compare mode calls `transcribe(audio)` and passes the
  unresolved `t.text` straight into three `command()` calls in one round trip.

Rough edges:

- A broken WebSocket session stays broken. `src/client/rpc.ts` uses `onRpcBroken` to drop the
  stub and reconnect on the next call; there's no built-in reconnect.
- A whole WebSocket session is one Worker request, so a long eval sweep counts every Workers
  AI and D1 call against that one request's subrequest limit. Large sweeps (many models ×
  strategies) may hit it; split them into several `runEval` calls if so. (Inferred from how
  Workers limits apply, not hit in testing.)
- HTTP batch sessions end after the batch, so callbacks only work over WebSocket.
- It doesn't help non-JS devices, which is why `/api/command` exists as well.

## Other rough edges found

- Clef isn't in `@cloudflare/workers-types`, `workers-ai-provider`, or the AI SDK's
  `experimental_decide`, so `decision.ts` calls `env.AI.run` directly with local types written
  from the model's published JSON schema.
- Code Mode's generated types render optional enum arrays without parentheses
  (`"mon" | ... | "sun"[]`), which is wrong TypeScript. Models seem to cope, but it's in the
  prompt.
- Claude Haiku/Sonnet/Opus 5.5 reject forced tool choice, so the decision strategy only forces
  the routed tool on non-Anthropic models.
- Locally, the Code Mode sandbox (Worker Loader → isolate → RPC back to the tool stubs) ran a
  two-call snippet in about 11 ms.

## Not yet tested

The strategies haven't run against live models: this was built without Cloudflare
credentials, so Workers AI (Clef, Whisper, the LLMs) was never called. The MCP strategy's
tool loop is covered by a unit test with a mock model (`src/worker/strategies/mcp.test.ts`),
and the Code Mode sandbox and all transport paths were exercised locally. The first eval sweep
after deploying is the real test, and the default thresholds and models are guesses to tune
from it.
