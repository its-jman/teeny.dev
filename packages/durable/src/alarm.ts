import {z, type ZodType} from 'zod'
import {decodeTime, ulidFactory} from 'ulid-workers'

// #region types
export type AlarmManager<TZod extends ZodType> = {
	(alarmInfo: AlarmInvocationInfo): void | Promise<void>
	cfg: AlarmManagerCfg<TZod>
	listAlarms: (listCfg?: ListAlarmsCfg) => Promise<Array<AlarmDetail<z.infer<TZod>>>>
	getNextAlarm: () => Promise<AlarmDetail<z.infer<TZod>> | undefined>
	scheduleAt: (at: Date, payload: z.infer<TZod>) => Promise<string>
	scheduleIn: (ms: number, payload: z.infer<TZod>) => Promise<string>
	scheduleEvery: (every: number, payload: z.infer<TZod>) => Promise<string>
	cancel: (alarmId: string) => Promise<boolean>
}
type ListAlarmsCfg = Pick<DurableObjectListOptions, 'start' | 'end' | 'limit'> | undefined
type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never

type AlarmCfg<T> = {originalId: string; payload: T} & (
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
	handler(ctx: AlarmDetail<z.infer<TZod>>): Promise<void> | void
	storage: DurableObjectStorage
}
// #endregion types

const RETRY_INTERVAL = 60 * 1000
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
export function createAlarmManager<TZod extends ZodType>(
	cfg: AlarmManagerCfg<TZod>
): AlarmManager<TZod> {
	type TPayload = z.infer<TZod>

	const idPrefix = `${PREFIX}##alarm##`
	const mapPrefix = `${PREFIX}##map##`

	/**
	 * Alarm handler
	 */
	async function alarmHandler(alarmInfo: AlarmInvocationInfo) {
		const toRun = await listAlarms({
			end: idPrefix + nonMonoUlid(Date.now() + 1),
		})

		/**
		 * Make this sync for now, maybe each run can happen in parallel?
		 */
		for (const run of toRun) {
			let hasErr
			try {
				run.attempt += 1
				await cfg.handler(run)
			} catch (err) {
				hasErr = true
				run.previousError = err as Error
				// Setting wake at end of loop, skip for now
				await scheduleAlarmAt(Date.now() + RETRY_INTERVAL, run, false)
				console.error(err)
			}
			if (!hasErr && run.type === 'every') {
				run.attempt = 0
				run.previousError = undefined
				// Setting wake at end of loop, skip for now
				await scheduleAlarmAt(Date.now() + run.every, run, false)
			}
			await cfg.storage.delete(run._key)
		}
		await setNextWake()
	}

	/**
	 * List Alarms
	 */
	async function listAlarms(listCfg: ListAlarmsCfg = {}) {
		const alarms = await cfg.storage.list<AlarmDetail<TPayload>>({
			...listCfg,
			prefix: idPrefix,
			start: listCfg.start ? idPrefix + listCfg.start : idPrefix,
		})
		return [...alarms.entries()].map(([_key, alarm]) => ({...alarm, _key}))
	}

	/**
	 * Get Next Alarm
	 */
	async function getNextAlarm(): Promise<AlarmDetail<TPayload> | undefined> {
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
	async function scheduleAlarmAt(
		ms: number,
		alarmCfg: DistributiveOmit<AlarmCfg<TPayload>, 'originalId'> & {originalId?: string},
		setWake: boolean | undefined = true
	) {
		const id = nonMonoUlid(ms)
		const originalId = alarmCfg.originalId ?? id
		await cfg.storage.put({
			[idPrefix + id]: {
				attempt: 0,
				previousError: undefined,
				...alarmCfg,
				originalId,
				id,
			} satisfies AlarmDetail<TPayload>,
			// Create mapping of original id to current id
			[mapPrefix + originalId]: id,
		})

		if (setWake) {
			await setNextWake()
		}
		return id
	}

	async function scheduleAt(at: Date, payload: TPayload) {
		cfg.payloadParser.parse(payload)
		const id = await scheduleAlarmAt(at.getTime(), {type: 'at', at, payload})
		return id
	}

	async function scheduleIn(ms: number, payload: TPayload) {
		cfg.payloadParser.parse(payload)
		const id = await scheduleAlarmAt(Date.now() + ms, {
			type: 'in',
			in: ms,
			payload,
		})
		return id
	}

	async function scheduleEvery(ms: number, payload: TPayload) {
		cfg.payloadParser.parse(payload)
		const id = await scheduleAlarmAt(Date.now() + ms, {
			type: 'every',
			every: ms,
			payload,
		})
		return id
	}

	async function cancel(alarmId: string) {
		const curr = await cfg.storage.get<string>(mapPrefix + alarmId)
		const res = await cfg.storage.delete([alarmId, idPrefix + alarmId, idPrefix + curr])
		return res > 0
	}

	return Object.assign(alarmHandler, {
		cfg,
		listAlarms,
		getNextAlarm,
		scheduleAt,
		scheduleIn,
		scheduleEvery,
		cancel,
	})
}
