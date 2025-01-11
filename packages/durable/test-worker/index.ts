import {DurableObject, type WorkerEntrypoint} from 'cloudflare:workers'
import {createTypedStorage} from '../src/storage'
import {z} from 'zod'
import {createAlarmManager} from '../src/alarm'

const OneItemSchema = z.object({url: z.string()})
const ManyItemSchema = z.object({
	title: z.string(),
	description: z.string(),
	id: z.string(),
})

export class StorageTest extends DurableObject {
	storage

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		const storage = createTypedStorage(state.storage, {
			one: OneItemSchema,
			many: ManyItemSchema,
		})
		this.storage = storage
	}
}

export class AlarmTest extends DurableObject {
	_am
	storage

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.storage = state.storage
		this._am = createAlarmManager({
			storage: state.storage,
			payloadParser: z.object({url: z.string()}),
			handler(payload) {
				this.storage.put('test', '1234')
			},
		})
		this.alarm = this._am.alarmHandler
	}
}

export default <WorkerEntrypoint>{}
