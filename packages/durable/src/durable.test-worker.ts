import {z} from 'zod'
import {DURABLE_OBJECT_VALIDATOR} from './_.test-lib'
import {createDurable, createTypedStorage} from '.'
import {
	FetchCreateContextFnOptions,
	fetchRequestHandler,
} from '@trpc/server/adapters/fetch'
import {initTRPC} from '@trpc/server'

const BASE_ENV_SCHEMA = z.object({
	STORAGE: DURABLE_OBJECT_VALIDATOR,
})
type BaseEnv = z.infer<typeof BASE_ENV_SCHEMA>

const initEnv = (_env: BaseEnv) => ({
	...BASE_ENV_SCHEMA.parse(_env),
	STORAGE: Storage.proxy(_env.STORAGE),
})
type Env = ReturnType<typeof initEnv>

export const Storage = createDurable((state, _env) => {
	const env = initEnv(_env as BaseEnv)
	const storage = createTypedStorage(state.storage, {
		name: z.object({first: z.string()}),
	})

	return {
		router: {
			name: {
				get() {
					return storage.name.get('name')
				},
				async set(name: string) {
					await storage.name.put('name', {first: name})
				},
			},
		},
		fallthrough(req) {
			return new Response('Hello!')
		},
	}
})

interface Context extends ExecutionContext, FetchCreateContextFnOptions {
	env: Env
}

const t = initTRPC.context<Context>().create()

const router = t.router({
	getName: t.procedure.query(({ctx}) => {
		const stub = ctx.env.STORAGE.getByName('name')
		return stub.rpc.name.get()
	}),
	setName: t.procedure
		.input(z.object({first: z.string()}))
		.mutation(async ({input, ctx}) => {
			const stub = ctx.env.STORAGE.getByName('name')
			await stub.rpc.name.set(input.first)
		}),
	getFallthrough: t.procedure.query(async ({ctx}) => {
		const id = ctx.env.STORAGE.newUniqueId()
		const stub = ctx.env.STORAGE.getById(id)
		return await (await stub.fetch('https://_/')).text()
	}),
})
export type AppRouter = typeof router

export default {
	async fetch(req, _env, ctx) {
		try {
			const env = initEnv(_env)

			return fetchRequestHandler({
				endpoint: '/trpc',
				req,
				router,
				createContext: ({req, resHeaders}) => ({
					env,
					waitUntil: ctx.waitUntil.bind(ctx),
					passThroughOnException: ctx.passThroughOnException.bind(ctx),
					req,
					resHeaders,
				}),
			})
		} catch (e) {
			console.error('err')
			console.error(e)
			return new Response(
				JSON.stringify({
					msg: 'ERROR',
					detail: (e as Error).message,
					stack: (e as Error).stack,
				})
			)
		}
	},
} satisfies ExportedHandler<BaseEnv>
