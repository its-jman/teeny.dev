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
	type MockInstance,
} from 'vitest'
import {getByName} from './utils'
import {decodeTime} from 'ulid-workers'

describe('alarms', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('can create and run alarms in order', async () => {
		const stub = getByName(env.ALARM_TEST, 'main')

		let handlerSpy: MockInstance = null! // Assert since runInDurable doesn't grant assignment before usage
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
		expect(handlerSpy.mock.calls[0]?.[0]?.payload!).toEqual({url: 'B'})

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
		expect(handlerSpy.mock.calls[1]?.[0]?.payload).toEqual({url: 'A'})
		expect(handlerSpy.mock.calls[2]?.[0]?.payload).toEqual({url: 'C'})

		await runInDurableObject(stub, async (inst) => {
			expect(await inst.storage.get('test')).eq('1234')
			expect(await inst._am.getNextAlarm()).toBeUndefined()
		})
		expect(await runDurableObjectAlarm(stub)).eq(false)
	})

	it("can cancel alarms, and knows when it didn't cancel", async () => {
		const stub = getByName(env.ALARM_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			const am = inst._am

			expect(await am.cancel('1234')).eq(false)
			const id1 = await am.scheduleIn(15 * 1000, {url: 'A'})
			const id2 = await am.scheduleEvery(10 * 1000, {url: 'B'})

			expect(await am.cancel(id1)).eq(true)
			expect(await am.cancel(id1)).eq(false)
			expect(await am.cancel(id2)).eq(true)
			expect(await am.cancel(id2)).eq(false)
			expect(await am.cancel(id1)).eq(false)
		})
		expect(await runDurableObjectAlarm(stub)).eq(true)
		expect(await runDurableObjectAlarm(stub)).eq(false)
	})

	it('can schedule AND CANCEL recurring alarms', async () => {
		const stub = getByName(env.ALARM_TEST, 'main')

		let id: string
		let handlerSpy
		await runInDurableObject(stub, async (inst) => {
			const am = inst._am
			handlerSpy = vi.spyOn(am.cfg, 'handler')
			id = await am.scheduleEvery(10 * 1000, {url: '1234'})

			expect(await inst.storage.getAlarm()).eq(decodeTime(id))
		})

		vi.setSystemTime(Date.now() + 10000)
		expect(await runDurableObjectAlarm(stub)).eq(true)
		expect(handlerSpy).toBeCalledTimes(1)

		// Has not be called, the next iter should be 10_000, not just 5_000
		vi.setSystemTime(Date.now() + 5000)
		expect(await runDurableObjectAlarm(stub)).eq(true)
		expect(handlerSpy).toBeCalledTimes(1)
		vi.setSystemTime(Date.now() + 5000)
		expect(await runDurableObjectAlarm(stub)).eq(true)
		expect(handlerSpy).toBeCalledTimes(2)

		await runInDurableObject(stub, async (inst) => {
			expect(await inst._am.cancel(id)).eq(true)
		})

		expect(await runDurableObjectAlarm(stub)).eq(true)
		expect(await runDurableObjectAlarm(stub)).eq(false)
	})

	it('can handle and reschedule errors', async () => {
		const stub = getByName(env.ALARM_TEST, 'main')

		let id: string
		let handlerSpy: MockInstance = null! // Assert since runInDurable doesn't grant assignment before usage
		await runInDurableObject(stub, async (inst) => {
			const am = inst._am
			handlerSpy = vi.spyOn(am.cfg, 'handler')
			id = await am.scheduleIn(10 * 1000, {url: 'ERROR'})
		})

		vi.setSystemTime(Date.now() + 10000)
		expect(await runDurableObjectAlarm(stub)).eq(true)
		expect(handlerSpy).toBeCalledTimes(1)

		// Alarm handler programmed to succeed the third time
		vi.setSystemTime(Date.now() + 60 * 1000)
		expect(await runDurableObjectAlarm(stub)).eq(true)
		expect(handlerSpy).toBeCalledTimes(2)
		expect(handlerSpy.mock.calls[1]?.[0]?.attempt).toEqual(2)

		// Alarm handler programmed to succeed the third time
		vi.setSystemTime(Date.now() + 60 * 1000)
		expect(await runDurableObjectAlarm(stub)).eq(true)
		expect(handlerSpy).toBeCalledTimes(3)
		expect(handlerSpy.mock.calls[2]?.[0]?.attempt).toEqual(3)

		// Properly disposes of entry once it runs successfully
		await runInDurableObject(stub, async (inst) => {
			expect(await inst._am.cancel(id)).eq(false)
		})

		expect(await runDurableObjectAlarm(stub)).eq(false)
	})
})
