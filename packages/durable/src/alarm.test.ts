import {describe, expect, expectTypeOf, it} from 'vitest'
import {createAlarmManager} from './alarm'
import {z} from 'zod'
import dayjs from 'dayjs'

describe('alarms', () => {
	it("describes it's calling object", () => {
		const am = createAlarmManager({
			simple: {
				async handler() {},
			},
			complex: {
				payload: z.object({url: z.string()}),
				async handler() {},
			},
		})

		expectTypeOf(am).toMatchTypeOf<{} & {simple: Manager; complex: Manager}>()

		am.simple.scheduleAt(dayjs())
		am.simple.scheduleIn(60 * 1000)
		am.simple.scheduleEvery(60 * 1000)
		am.simple.cancelTask(taskId)
	})
})
