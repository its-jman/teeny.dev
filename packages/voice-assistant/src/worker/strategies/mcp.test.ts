import {MockLanguageModelV4} from 'ai/test'
import {describe, expect, it, vi} from 'vitest'
import {ToolRecorder} from '../tools'
import {runMcp} from './mcp'

const model = new MockLanguageModelV4({
	doGenerate: async () => ({
		content: [
			{
				type: 'tool-call',
				toolCallId: '1',
				toolName: 'set_light',
				input: JSON.stringify({light: 'kitchen', on: true}),
			},
			{
				type: 'tool-call',
				toolCallId: '2',
				toolName: 'start_car_ac',
				input: JSON.stringify({temperatureF: 68}),
			},
		],
		finishReason: {unified: 'tool-calls', raw: undefined},
		usage: {
			inputTokens: {
				total: 100,
				noCache: 100,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: {total: 20, text: 20, reasoning: undefined},
		},
		warnings: [],
	}),
})

vi.mock('../models', () => ({
	getModel: () => ({model, def: {inputPerM: 1, outputPerM: 1}}),
	costUsd: () => 0.00012,
}))

describe('runMcp', () => {
	it('discovers tools over MCP and records calls, stopping once they succeed', async () => {
		const recorder = new ToolRecorder()
		const out = await runMcp({
			env: {} as Env,
			transcript: 'x',
			model: 'mock',
			timezone: 'UTC',
			recorder,
		})
		expect(recorder.calls.map((c) => [c.tool, c.args])).toEqual([
			['set_light', {light: 'kitchen', on: true}],
			['start_car_ac', {temperatureF: 68}],
		])
		expect(model.doGenerateCalls).toHaveLength(1)
		expect(model.doGenerateCalls[0]!.tools?.map((t) => t.name)).toContain(
			'create_linear_ticket'
		)
		expect(out.response).toBe('Done: set_light, start_car_ac')
		expect(out.meta.mcpToolCount).toBe(6)
	})
})
