import {DurableObject, type WorkerEntrypoint} from 'cloudflare:workers'
import {createTypedStorage} from '../src/storage'
import {z} from 'zod'
import {createAlarmManager, type AlarmManager} from '../src/alarm'
import {prepareSqlite} from '../src'

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

const AlarmSchema = z.object({url: z.string()})
export class AlarmTest extends DurableObject {
	alarm: AlarmManager<typeof AlarmSchema>
	storage

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.storage = ctx.storage
		this.alarm = createAlarmManager({
			storage: ctx.storage,
			payloadParser: AlarmSchema,
			handler(ctx) {
				if (ctx.payload.url === 'ERROR' && ctx.attempt <= 2) {
					throw new Error('__TEST_EXPECTED__')
				}
				this.storage.put('test', '1234')
			},
		})
	}
}

export class SqlTest extends DurableObject {
	ctx
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.ctx = ctx
	}
}

export default <WorkerEntrypoint>{}
