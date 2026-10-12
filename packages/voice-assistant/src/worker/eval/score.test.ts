import {describe, expect, it} from 'vitest'
import type {ToolCallRecord} from '../../shared/api'
import {scoreCase} from './score'

const call = (tool: string, args: Record<string, unknown> = {}): ToolCallRecord => ({
	tool,
	args,
	ms: 0,
	result: null,
})

describe('scoreCase', () => {
	it('rewards no calls when none expected', () => {
		expect(scoreCase([], [])).toBe(1)
		expect(scoreCase([], [call('create_note')])).toBe(0)
	})

	it('scores tool and args', () => {
		const exp = [{tool: 'create_alarm' as const, args: {time: '07:00', label: 'gym'}}]
		expect(scoreCase(exp, [call('create_alarm', {time: '7:00', label: 'Gym'})])).toBe(1)
		expect(scoreCase(exp, [call('create_alarm', {time: '08:00', label: 'gym'})])).toBe(
			0.75
		)
		expect(scoreCase(exp, [call('create_reminder', {text: 'gym'})])).toBe(0)
	})

	it('penalizes missing and extra calls', () => {
		const exp = [
			{tool: 'start_car_ac' as const},
			{tool: 'set_light' as const, args: {on: false}},
		]
		expect(scoreCase(exp, [call('start_car_ac')])).toBe(0.5)
		expect(
			scoreCase(exp, [
				call('start_car_ac'),
				call('set_light', {on: false}),
				call('create_note'),
			])
		).toBeCloseTo(2 / 3)
	})

	it('matches numbers and booleans', () => {
		expect(
			scoreCase(
				[{tool: 'start_car_ac', args: {temperatureF: 68}}],
				[call('start_car_ac', {temperatureF: 68})]
			)
		).toBe(1)
		expect(
			scoreCase([{tool: 'set_light', args: {on: true}}], [call('set_light', {on: false})])
		).toBe(0.5)
	})
})
