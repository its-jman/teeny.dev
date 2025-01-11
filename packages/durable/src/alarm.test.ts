import {env, runDurableObjectAlarm, runInDurableObject} from 'cloudflare:test'
import {
	afterEach,
	assert,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	it,
	vi,
} from 'vitest'
import {z} from 'zod'
import dayjs from 'dayjs'
import {getByName} from './utils'
import {decodeTime} from 'ulid-workers'

const undef = z.undefined()
const complex = z.object({url: z.string()})

describe('alarms', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('can actually call arrow fn', () => {
		const stub = env.ALARM_TEST.get(env.ALARM_TEST.idFromName('main'))
		stub.storage
	})

	it("describes it's calling object", async () => {
		const stub = getByName(env.ALARM_TEST, 'main')

		let handlerSpy
		await runInDurableObject(stub, async (inst) => {
			const am = inst._am
			handlerSpy = vi.spyOn(am.cfg, 'handler')

			let nextAlarm = await am.getNextAlarm()
			expect(nextAlarm).toBeUndefined()
			await am.scheduleIn(15 * 1000, {url: 'A'})
			const alarmId = await am.scheduleIn(10 * 1000, {url: 'B'})
			await am.scheduleIn(20 * 1000, {url: 'C'})

			nextAlarm = await am.getNextAlarm()
			expect(nextAlarm).not.toBeUndefined()
			assert(nextAlarm?.type === 'in', `Expected: "in", Got: "${nextAlarm?.type}"`)
			expect(nextAlarm.in).eq(10 * 1000)

			const nextWake = await inst.storage.getAlarm()
			expect(nextWake).eq(decodeTime(alarmId))
		})

		vi.setSystemTime(Date.now() + 10000)
		assert(await runDurableObjectAlarm(stub))
		expect(handlerSpy).toBeCalledTimes(1)
		expect(handlerSpy).toBeCalledWith({url: 'B'})

		await runInDurableObject(stub, async (inst) => {
			const am = inst._am
			let nextAlarm = await am.getNextAlarm()
			assert(nextAlarm)
			assert(nextAlarm.type === 'in')
			expect(nextAlarm.in).eq(15 * 1000)
		})

		vi.setSystemTime(Date.now() + 20000)
		expect(await runDurableObjectAlarm(stub)).eq(true)
		expect(handlerSpy).toBeCalledTimes(3)
		expect(handlerSpy).toBeCalledWith({url: 'A'})
		expect(handlerSpy).toBeCalledWith({url: 'C'})

		await runInDurableObject(stub, async (inst) => {
			expect(await inst.storage.get('test')).eq('1234')
			expect(await inst._am.getNextAlarm()).toBeUndefined()
		})
		expect(await runDurableObjectAlarm(stub)).eq(false)
	})

	// am.listAlarms()

	/* am.simple.scheduleAt(dayjs().toDate(), undefined)
			am.simple.scheduleIn(60 * 1000, undefined)
			am.simple.scheduleEvery(60 * 1000, undefined)

			am.simple.cancel('1234')
			am.simple.cancelAll()

			am.complex.scheduleIn(1, {url: '1234'}) */
})
