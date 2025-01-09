import {DurableObject, type WorkerEntrypoint} from 'cloudflare:workers'
import {createTypedStorage} from '../src/storage'
import {z} from 'zod'

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

export default <WorkerEntrypoint>{}
