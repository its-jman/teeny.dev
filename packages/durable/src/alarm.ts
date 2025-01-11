import {z, type TypeOf, type ZodType} from 'zod'
import {createTypedStorage} from './storage'
import {decodeTime, ulidFactory} from 'ulid-workers'

// #region types
type ListAlarmsCfg = Pick<DurableObjectListOptions, 'start' | 'end' | 'limit'> | undefined

type AlarmCfg<T> = {payload: T} & (
	| {type: 'at'; at: Date}
	| {type: 'in'; in: number}
	| {type: 'every'; every: number}
)

type AlarmDetail<T> = AlarmCfg<T> & {
	id: string
	attempt: number
	previousError: Error | undefined
}

type AlarmManagerCfg<TZod extends ZodType> = {
	payloadParser: TZod
	handler(payload: z.infer<TZod>): Promise<void> | void
	storage: DurableObjectStorage
}
// #endregion types

const PREFIX = '$$_alarm'
// WARNING: monoUlid will only ever return values greater than the highest timestamp passed to it.
// const monoUlid = ulidFactory()
const nonMonoUlid = ulidFactory({monotonic: false})

/**
 * Ideas:
 *  - extended: extends AlarmManager
 *  - decorator: @alarmManager
 *  - function: this.alarm = createAlarmManager()
 *
 * storage:
 * 	$$_alarm##
 * 	each alarm has a time or interval
 * 	recurring or errord alarms get re-inserted into
 * 	current alarms fetched by .list({start, end: `$$_alarms##now+1` })
 *
 *
 */

// export class AlarmManager<TZod extends ZodType> {
// 	constructor(public cfg: AlarmManagerCfg<TZod>) {}

// 	/**
// 	 * Alarm handler
// 	 */
// 	async alarmHandler(alarmInfo: AlarmInvocationInfo) {
// 		const toRun = await this.listAlarms({
// 			end: `${PREFIX}##${nonMonoUlid(Date.now() + 1)}`,
// 		})

// 		/**
// 		 * Make this sync for now, maybe each run can happen in parallel?
// 		 */
// 		for (const run of toRun) {
// 			try {
// 				await this.cfg.handler(run.payload)
// 			} catch (err) {
// 				console.error(err)
// 			}
// 			await this.cfg.storage.delete(run._key)
// 		}
// 		await this.setNextWake()
// 	}

// 	/**
// 	 * List Alarms
// 	 */
// 	async listAlarms(cfg: ListAlarmsCfg = {}) {
// 		const prefix = `${PREFIX}##`
// 		const alarms = await this.cfg.storage.list<AlarmDetail<z.infer<TZod>>>({
// 			...cfg,
// 			prefix,
// 			start: cfg.start ? `${prefix}${cfg.start}` : prefix,
// 		})
// 		return [...alarms.entries()].map(([_key, alarm]) => ({...alarm, _key}))
// 	}

// 	/**
// 	 * Get Next Alarm
// 	 */
// 	async getNextAlarm(): Promise<AlarmDetail<z.infer<TZod>> | undefined> {
// 		const alarms = await this.listAlarms({limit: 1})
// 		return alarms[0]
// 	}

// 	/**
// 	 * Set next wake time (after alarms run, or new alarms created)
// 	 */
// 	async setNextWake() {
// 		const nextAlarm = await this.getNextAlarm()
// 		if (nextAlarm) {
// 			const time = decodeTime(nextAlarm.id)
// 			await this.cfg.storage.setAlarm(time)
// 		}
// 	}

// 	/**
// 	 *
// 	 */
// 	async scheduleAlarmAt(ms: number, cfg: AlarmCfg<z.infer<TZod>>) {
// 		const id = nonMonoUlid(ms)
// 		await this.cfg.storage.put<AlarmDetail<z.infer<TZod>>>(`${PREFIX}##${id}`, {
// 			...cfg,
// 			id,
// 			attempt: 0,
// 			previousError: undefined,
// 		})
// 		await this.setNextWake()
// 		return id
// 	}

// 	async scheduleAt(at: Date, payload: z.infer<TZod>) {
// 		const id = await this.scheduleAlarmAt(at.getTime(), {type: 'at', at, payload})
// 		return id
// 	}
// 	async scheduleIn(ms: number, payload: z.infer<TZod>) {
// 		const id = await this.scheduleAlarmAt(Date.now() + ms, {type: 'in', in: ms, payload})
// 		return id
// 	}
// 	async scheduleEvery(ms: number, payload: z.infer<TZod>) {
// 		return '1234'
// 	}
// 	async cancel(alarmId: string) {
// 		return true
// 	}
// 	async cancelAll() {
// 		return true
// 	}
// }

export function createAlarmManager<TZod extends ZodType>(cfg: AlarmManagerCfg<TZod>) {
	/**
	 * Alarm handler
	 */
	async function alarmHandler(alarmInfo: AlarmInvocationInfo) {
		const toRun = await listAlarms({
			end: `${PREFIX}##${nonMonoUlid(Date.now() + 1)}`,
		})

		/**
		 * Make this sync for now, maybe each run can happen in parallel?
		 */
		for (const run of toRun) {
			try {
				await cfg.handler(run.payload)
			} catch (err) {
				console.error(err)
			}
			await cfg.storage.delete(run._key)
		}
		await setNextWake()
	}

	/**
	 * List Alarms
	 */
	async function listAlarms(listCfg: ListAlarmsCfg = {}) {
		const prefix = `${PREFIX}##`
		const alarms = await cfg.storage.list<AlarmDetail<z.infer<TZod>>>({
			...listCfg,
			prefix,
			start: listCfg.start ? `${prefix}${listCfg.start}` : prefix,
		})
		return [...alarms.entries()].map(([_key, alarm]) => ({...alarm, _key}))
	}

	/**
	 * Get Next Alarm
	 */
	async function getNextAlarm(): Promise<AlarmDetail<z.infer<TZod>> | undefined> {
		const alarms = await listAlarms({limit: 1})
		return alarms[0]
	}

	/**
	 * Set next wake time (after alarms run, or new alarms created)
	 */
	async function setNextWake() {
		const nextAlarm = await getNextAlarm()
		if (nextAlarm) {
			const time = decodeTime(nextAlarm.id)
			await cfg.storage.setAlarm(time)
		}
	}

	/**
	 * Schedule alarm at specific millisecond timestamp
	 */
	async function scheduleAlarmAt(ms: number, alarmCfg: AlarmCfg<z.infer<TZod>>) {
		const id = nonMonoUlid(ms)
		await cfg.storage.put<AlarmDetail<z.infer<TZod>>>(`${PREFIX}##${id}`, {
			...alarmCfg,
			id,
			attempt: 0,
			previousError: undefined,
		})
		await setNextWake()
		return id
	}

	async function scheduleAt(at: Date, payload: z.infer<TZod>) {
		const id = await scheduleAlarmAt(at.getTime(), {type: 'at', at, payload})
		return id
	}

	async function scheduleIn(ms: number, payload: z.infer<TZod>) {
		const id = await scheduleAlarmAt(Date.now() + ms, {
			type: 'in',
			in: ms,
			payload,
		})
		return id
	}

	async function scheduleEvery(ms: number, payload: z.infer<TZod>) {
		return '1234'
	}

	async function cancel(alarmId: string) {
		return true
	}

	async function cancelAll() {
		return true
	}

	return {
		cfg,
		alarmHandler,
		listAlarms,
		getNextAlarm,
		setNextWake,
		scheduleAlarmAt,
		scheduleAt,
		scheduleIn,
		scheduleEvery,
		cancel,
		cancelAll,
	}
}
