import {
	CreateTRPCClientOptions,
	createTRPCProxyClient,
	httpBatchLink,
	inferRouterProxyClient,
} from '@trpc/client'
import {type AnyRouter} from '@trpc/server'
import {fetchRequestHandler} from '@trpc/server/adapters/fetch'

// type DurableState = DurableObjectState
// type DurableStorage = DurableObjectStorage
// type DurableNamespace = DurableObjectNamespace
// type DurableStub = DurableObjectStub
// type DurableId = DurableObjectId

type Parser<TInput> = {parse: (val: unknown) => TInput}
type ParserOutput<TParser extends Parser<any>> = ReturnType<TParser['parse']>

export namespace TeenyDurable {
	export interface Ctx<TEnv = unknown> {
		req: Request
		resHeaders: Headers
		env: TEnv
		state: DurableObjectState
		storage: DurableObjectStorage
	}

	export type Stub<
		TBaseEnv,
		TInitializiedEnv,
		TRouter extends AnyRouter
	> = DurableObjectStub & {
		trpc: inferRouterProxyClient<TRouter>
	}

	export type Namespace<
		TBaseEnv,
		TInitializiedEnv,
		TRouter extends AnyRouter
	> = DurableObjectNamespace & {
		_getStub: DurableObjectNamespace['get']
		getByName(name: string): TeenyDurable.Stub<TBaseEnv, TInitializiedEnv, TRouter>
		getById(
			id: string | DurableObjectId
		): TeenyDurable.Stub<TBaseEnv, TInitializiedEnv, TRouter>
	}

	export type Cls<TBaseEnv, TInitializiedEnv, TRouter extends AnyRouter> = {
		(state: DurableObjectState, env: TBaseEnv): DurableObject
		proxy(
			ns: DurableObjectNamespace
		): TeenyDurable.Namespace<TBaseEnv, TInitializiedEnv, TRouter>
	}

	export type infer<TDurable extends TeenyDurable.Cls<any, any, any>> = ReturnType<
		TDurable['proxy']
	>
}

export interface CreateDurableProps<TBaseEnv, TInitializiedEnv, TRouter extends AnyRouter>
	extends Omit<DurableObject, 'fetch'> {
	baseEnvSchema?: Parser<TBaseEnv>
	initEnv: (env: TBaseEnv) => TInitializiedEnv
	router: TRouter
}

export const ENDPOINT = '/trpc'
export function createDurable<TBaseEnv, TInitializiedEnv, TRouter extends AnyRouter>(
	props: CreateDurableProps<TBaseEnv, TInitializiedEnv, TRouter>
): TeenyDurable.Cls<TBaseEnv, TInitializiedEnv, TRouter> {
	type Proxy = TeenyDurable.Namespace<TBaseEnv, TInitializiedEnv, TRouter>
	type Stub = TeenyDurable.Stub<TBaseEnv, TInitializiedEnv, TRouter>

	function handler(state: DurableObjectState, _env: TBaseEnv): DurableObject {
		const {router, initEnv} = props
		const env = initEnv(props.baseEnvSchema ? props.baseEnvSchema.parse(_env) : _env)

		return {
			fetch: (req) => {
				return fetchRequestHandler({
					endpoint: ENDPOINT,
					req: req as unknown as Request,
					router: router,
					createContext: ({req, resHeaders}): TeenyDurable.Ctx<TInitializiedEnv> => ({
						req,
						resHeaders,
						env,
						state,
						storage: state.storage,
					}),
				})
			},
			...props,
		}
	}

	handler.proxy = (ns: DurableObjectNamespace): Proxy => {
		function get(id: DurableObjectId): Stub {
			const stub = ns.get(id)

			return Object.assign(stub, {
				trpc: createTRPCProxyClient<TRouter>({
					links: [
						httpBatchLink({
							url: `https://_${ENDPOINT}`,
							fetch: stub.fetch.bind(stub) as unknown as typeof fetch,
						}),
					],
					// idk... assertion gross, but getting weird type error
				} as CreateTRPCClientOptions<TRouter>),
			})
		}

		return Object.assign({}, ns, {
			_getStub: ns.get.bind(ns),
			get,
			getByName: (name: string) => {
				const id = ns.idFromName(name)
				return get(id)
			},
			getById: (idOrStr: string | DurableObjectId) => {
				const id = typeof idOrStr === 'string' ? ns.idFromString(idOrStr) : idOrStr
				return get(id)
			},
		})
	}

	return handler
}

interface TeenyNamespace extends DurableObjectNamespace {
	getByName(name: string): DurableObjectStub
	getById(id: string | DurableObjectId): DurableObjectStub
}

export function createTeenyNamespace(ns: DurableObjectNamespace): TeenyNamespace {
	return Object.assign({}, ns, {
		getByName: (name: string) => {
			const id = ns.idFromName(name)
			return ns.get(id)
		},
		getById: (id: string | DurableObjectId) => {
			if (typeof id === 'string') {
				id = ns.idFromString(id)
			}
			return ns.get(id)
		},
	})
}

const FEED_STORAGE = createTeenyNamespace({} as any)

export function proxyTeenyDurable(ns: DurableObjectNamespace): TeenyNamespace {
	const teenyNs = createTeenyNamespace(ns)

	return Object.assign(teenyNs, {
		getByName: (name: string) => {
			const stub = teenyNs.getByName(name)
			return 5
		},
	})
}
