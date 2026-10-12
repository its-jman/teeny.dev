import {tool, type ToolSet} from 'ai'
import {z} from 'zod'
import type {ToolCallRecord, ToolName} from '../shared/api'

// Every tool is defined once here and adapted for each strategy (AI SDK tools, MCP tools,
// Code Mode). Handlers are stubs: they validate, record the call, and return a fake result.

type ToolDef<S extends z.ZodObject> = {
	description: string
	schema: S
	handler: (args: z.infer<S>) => Promise<Record<string, unknown>>
}

const def = <S extends z.ZodObject>(d: ToolDef<S>) => d

const stubId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`

export const TOOLS = {
	create_alarm: def({
		description: 'Set an alarm that rings at a specific time of day.',
		schema: z.object({
			time: z.string().describe('Local time in 24h HH:MM, e.g. "07:30"'),
			label: z.string().optional().describe('Optional alarm label'),
			days: z
				.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']))
				.optional()
				.describe('Repeat days. Omit for a one-off alarm.'),
		}),
		// TODO: wire to a real alarm backend (device push, calendar, ...)
		handler: async (args) => ({ok: true, alarmId: stubId('alarm'), ...args}),
	}),
	create_note: def({
		description: 'Save a free-form note.',
		schema: z.object({
			body: z.string().describe('The note contents'),
			title: z.string().optional(),
		}),
		// TODO: wire to notes storage
		handler: async (args) => ({ok: true, noteId: stubId('note'), ...args}),
	}),
	create_reminder: def({
		description:
			'Create a reminder to do something, optionally at a date/time. Use this (not an alarm) for "remind me to ...".',
		schema: z.object({
			text: z.string().describe('What to be reminded about'),
			due: z
				.string()
				.optional()
				.describe(
					'ISO 8601 local datetime, e.g. "2026-10-13T09:00". Omit if no time given.'
				),
		}),
		// TODO: wire to reminders backend
		handler: async (args) => ({ok: true, reminderId: stubId('rem'), ...args}),
	}),
	create_linear_ticket: def({
		description: 'File a new issue/ticket in Linear.',
		schema: z.object({
			title: z.string().describe('Short issue title'),
			description: z.string().optional(),
			priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
			team: z.string().optional().describe('Linear team key or name, if mentioned'),
		}),
		// TODO: call Linear's GraphQL API (issueCreate)
		handler: async (args) => ({ok: true, issueId: stubId('LIN'), ...args}),
	}),
	start_car_ac: def({
		description: "Remotely start the car's climate control / air conditioning.",
		schema: z.object({
			temperatureF: z.number().optional().describe('Target cabin temperature in °F'),
		}),
		// TODO: wire to the car's API
		handler: async (args) => ({ok: true, climate: 'on', ...args}),
	}),
	set_light: def({
		description: 'Turn a smart light on or off, optionally setting brightness or color.',
		schema: z.object({
			light: z.string().describe('Light or room name, e.g. "kitchen", "desk lamp"'),
			on: z.boolean().describe('true to turn on, false to turn off'),
			brightness: z.number().min(0).max(100).optional().describe('Percent 0-100'),
			color: z.string().optional().describe('Color name or hex'),
		}),
		// TODO: wire to the smart-home hub
		handler: async (args) => ({ok: true, ...args}),
	}),
} satisfies Record<ToolName, ToolDef<z.ZodObject>>

export type ToolRegistry = typeof TOOLS

/** Executes tools and records each call so every strategy is measured the same way. */
export class ToolRecorder {
	readonly calls: ToolCallRecord[] = []

	get totalMs() {
		return this.calls.reduce((sum, c) => sum + c.ms, 0)
	}

	async run(name: string, rawArgs: unknown): Promise<unknown> {
		const t = TOOLS[name as ToolName]
		if (!t) throw new Error(`Unknown tool: ${name}`)
		const args = t.schema.parse(rawArgs) as Record<string, unknown>
		const start = performance.now()
		const result = await (t.handler as (a: unknown) => Promise<unknown>)(args)
		this.calls.push({tool: name, args, ms: performance.now() - start, result})
		return result
	}
}

/** AI SDK `tool()` wrappers, optionally limited to a subset. */
export function aiSdkTools(recorder: ToolRecorder, only?: ToolName[]): ToolSet {
	const names = only ?? (Object.keys(TOOLS) as ToolName[])
	return Object.fromEntries(
		names.map((name) => {
			const t = TOOLS[name]
			return [
				name,
				tool({
					description: t.description,
					inputSchema: t.schema,
					execute: (args: unknown) => recorder.run(name, args),
				}),
			]
		})
	)
}
