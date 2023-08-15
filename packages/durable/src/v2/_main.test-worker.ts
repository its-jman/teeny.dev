import {initTRPC} from '@trpc/server'
import {z} from 'zod'
import {type TeenyDurable, createDurable} from './index'
import {DURABLE_OBJECT_VALIDATOR} from '../_.test-lib'

const BASE_ENV_SCHEMA = z.object({
	STORAGE: DURABLE_OBJECT_VALIDATOR,
})
type BaseEnv = z.infer<typeof BASE_ENV_SCHEMA>

interface Env extends Omit<BaseEnv, 'STORAGE'> {
	STORAGE: TeenyDurable.infer<typeof Storage>
}

const t = initTRPC.context<TeenyDurable.Ctx<BaseEnv>>().create()

export const Storage = createDurable({
	baseEnvSchema: BASE_ENV_SCHEMA,
	initEnv: (env) => env,
	router: t.router({
		setUser: t.procedure.input(z.string()).mutation(({input, ctx}) => {
			ctx.storage.put('user', {name: input})
		}),
		getUser: t.procedure.query(({ctx}) => {
			return ctx.storage.get('user')
		}),
	}),
})

export default {
	async fetch(req, _env, ctx) {
		const env: Env = {
			...BASE_ENV_SCHEMA.parse(_env),
			STORAGE: Storage.proxy(_env.STORAGE),
		}
		const stub = env.STORAGE.getByName('stub')
		const url = new URL(req.url)

		if (url.pathname === '/get') {
			return new Response(JSON.stringify(await stub.trpc.getUser.query()))
		} else if (url.pathname.startsWith('/put')) {
			return new Response(await stub.trpc.setUser.mutate(url.pathname))
		} else {
			return new Response('???')
		}
	},
} satisfies ExportedHandler<BaseEnv>
