import {stringify, parse} from 'superjson'
import {Proxied, createClientProxy, fetchAdapter, routeHttpToObject} from './rpc'
import {ZodObject, ZodType, z} from 'zod'

export type inferTeenyDurable<T extends TeenyDurableCls<any, any>> = ReturnType<
	T['proxy']
>

export type TeenyDurableStub<TRouter> = DurableObjectStub & {rpc: TRouter}

export interface TeenyDurableNamespace<TRouter>
	extends Omit<DurableObjectNamespace, 'get'> {
	_getStub: DurableObjectNamespace['get']
	get: (id: DurableObjectId) => TeenyDurableStub<Proxied<TRouter>>
	getByName: (name: string) => TeenyDurableStub<Proxied<TRouter>>
	getById: (id: string | DurableObjectId) => TeenyDurableStub<Proxied<TRouter>>
}

export type DurableObjectCtor<TEnv> = (
	state: DurableObjectState,
	env: TEnv
) => DurableObject

export interface TeenyDurableCls<TEnv, TRouter> extends DurableObjectCtor<TEnv> {
	proxy: (ns: DurableObjectNamespace) => TeenyDurableNamespace<TRouter>
}

export interface TeenyDurableConfig<TEnv, TRouter> extends Omit<DurableObject, 'fetch'> {
	router: TRouter
	pathname?: string
	parseTransform?: (body: string) => unknown
	stringifyTransform?: (payload: unknown) => string
	fallthrough?: (req: Request) => Response | Promise<Response>
}

export type ConfigBuilder<TEnv, TRouter> = (
	state: DurableObjectState,
	env: TEnv
) => TeenyDurableConfig<TEnv, TRouter>

export function createDurable<TEnv, TRouter>(
	buildConfig: ConfigBuilder<TEnv, TRouter>
): TeenyDurableCls<TEnv, TRouter> {
	// Must be function, not arrow, otherwise `workerd` doesn't see it as a constructable
	const handler: DurableObjectCtor<TEnv> = function (state, env) {
		const {
			pathname = '/rpc',
			router,
			fallthrough,
			parseTransform,
			stringifyTransform,
			...rest
		} = buildConfig(state, env)

		return {
			async fetch(req) {
				const url = new URL(req.url)
				if (url.pathname === pathname) {
					return await routeHttpToObject(req, {
						router,
						stringify: stringifyTransform ?? stringify,
						parse: parseTransform ?? parse,
					})
				}

				// Fallthrough if exists
				if (fallthrough) return await fallthrough(req)

				return new Response(
					JSON.stringify({
						msg: `Invalid request: Expected ${pathname} or a defined fallthrough, got ${url.pathname}`,
					}),
					{status: 400}
				)
			},
			...rest,
		} satisfies DurableObject
	}

	return Object.assign(handler, {
		proxy(ns: DurableObjectNamespace) {
			const _getStub = ns.get.bind(ns)

			function get(id: DurableObjectId): TeenyDurableStub<Proxied<TRouter>> {
				const stub = _getStub(id)
				return Object.assign(stub, {
					rpc: createClientProxy<TRouter>((rpcReq) => {
						/**
						 * This is on the client (eg. worker), when calling stub = ns.getByName("Bob")
						 * 		You then need to return a proxified rpc object.
						 * 		await stub.rpc.getName()
						 * The typing is done by createClientProxy, now this just actually needs to return the actual
						 * 		async request which needs to be awaited
						 */
						console.log('rpcReq', rpcReq)
						const stubFetch = stub.fetch.bind(stub) as unknown as typeof window.fetch
						return fetchAdapter(stubFetch, {
							stringify,
							parse,
						})(rpcReq)
					}),
				})
			}

			// @ts-ignore -- Added back in at the assign, overwrite doesn't seem to work correctly (recursing)
			delete ns.get
			return Object.assign(ns, {
				_getStub,
				get,
				getByName: (name: string) => {
					const id = ns.idFromName(name)
					return get(id)
				},
				getById: (id: string | DurableObjectId) => {
					if (typeof id === 'string') {
						id = ns.idFromString(id)
					}
					return get(id)
				},
			} satisfies Omit<TeenyDurableNamespace<TRouter>, keyof Omit<DurableObjectNamespace, 'get'>>)
		},
	})
}

interface TypedStorageItem<T> {
	// get
	get(key: string, opts?: DurableObjectGetOptions): Promise<T | undefined>
	get(key: string[], opts?: DurableObjectGetOptions): Promise<Map<string, T>>
	// list
	list(opts?: DurableObjectListOptions): Promise<Map<string, T>>
	// put
	put(entries: Record<string, T>, opts?: DurableObjectPutOptions): Promise<void>
	put(key: string, value: T, opts?: DurableObjectPutOptions): Promise<void>
	// delete
	delete(key: string, opts?: DurableObjectPutOptions): Promise<boolean>
	delete(keys: string[], opts?: DurableObjectPutOptions): Promise<number>
}

type TypedStorageCfg = {[key: string]: ZodType}
type TypedStorageInterface<TCfg extends TypedStorageCfg> = {
	[K in keyof TCfg]: TypedStorageItem<z.TypeOf<TCfg[K]>>
}

// TODO: This whole thing is incredibly dumb, not typesafe, just dumb.
//   - how to even fix this? Build it without generics to assert
//     implementation, then force / assert into the non-generic version?
//   - Is there any way to actually do this safely with generics?
const createTypedStorageItem = <T extends ZodType>(
	storage: DurableObjectStorage,
	storagePrefix: string,
	validator: T
): TypedStorageItem<z.TypeOf<T>> => {
	const prefix = (val: string) => `${storagePrefix}##${val}`
	return {
		async get(keyOrKeys, opts) {
			if (typeof keyOrKeys === 'string') {
				const val = await storage.get<string>(prefix(keyOrKeys), opts)
				console.log('val', val)
				if (val === undefined) return val
				return validator.parse(parse(val)) as any
			} else {
				const vals = await storage.get<string>(keyOrKeys.map(prefix), opts)
				const out = new Map()
				for (const [k, v] of vals) {
					const parsed = validator.safeParse(parse(v))
					if (parsed.success) {
						out.set(k, parsed.data)
					}
				}
				return out
			}
		},
		list(opts) {
			return storage.list({
				...opts,
				prefix: prefix(opts?.prefix ?? ''),
			})
		},
		// TODO: idk how to represent this as overloaded...
		put(...args) {
			if (typeof args[0] === 'string') {
				const [key, _val, opts] = args as [string, unknown, DurableObjectPutOptions]
				const val = stringify(validator.parse(_val))
				return storage.put<string>(prefix(key), val, opts)
			} else {
				const [_vals, opts] = args as [Record<string, string>, DurableObjectPutOptions]
				const vals: Record<string, z.TypeOf<T>> = {}
				for (const [key, _val] of Object.entries(_vals)) {
					const val = stringify(validator.parse(_val))
					vals[prefix(key)] = val
				}
				return storage.put(vals, opts)
			}
		},
		delete(keyOrKeys, opts) {
			if (typeof keyOrKeys === 'string') {
				return storage.delete(prefix(keyOrKeys), opts)
			} else {
				return storage.delete(keyOrKeys.map(prefix), opts) as any
			}
		},
	}
}

export function createTypedStorage<TCfg extends TypedStorageCfg>(
	storage: DurableObjectStorage,
	cfg: TCfg
): DurableObjectStorage & TypedStorageInterface<TCfg> {
	const typedStorage: Partial<TypedStorageInterface<TCfg>> = {}

	for (const prefix in cfg) {
		typedStorage[prefix] = createTypedStorageItem(storage, prefix, cfg[prefix])
	}

	// Assertion because idk how to do this in typescript...
	return Object.assign(storage, typedStorage as TypedStorageInterface<TCfg>)
}
