import ky from 'ky'
import {z} from 'zod'

// #region ------------ RPC typing ------------
export const noop = () => {}
export type Fn<A extends any[] = any[], R = any> = (...args: A) => R
export type IsFunction<T> = T extends (...args: any[]) => any ? T : never

export type Promisify<T> = T extends (...args: any[]) => infer R
	? R extends Promise<infer U>
		? (...args: Parameters<T>) => Promise<U>
		: (...args: Parameters<T>) => Promise<R>
	: never

export type HasDirectCallableProperties<T> = {
	[K in keyof T]: T[K] extends (...args: any[]) => any ? true : never
}[keyof T]

export type HasCallableProperties<T> = T extends any[]
	? false
	: T extends object
	? true extends {[K in keyof T]: DeepPromisify<T[K]>}[keyof T]
		? true
		: HasDirectCallableProperties<T>
	: false

export type CallableKeys<T> = {
	[K in keyof T]: T[K] extends (...args: any[]) => any
		? K
		: true extends HasCallableProperties<T[K]>
		? K
		: never
}[keyof T]

export type DeepPromisify<T> = T extends any[]
	? never
	: T extends object
	? {
			[K in CallableKeys<T>]: T[K] extends (...args: any[]) => any
				? Promisify<IsFunction<T[K]>>
				: DeepPromisify<T[K]>
	  }
	: never

export type Proxied<T> = DeepPromisify<T>

export const RPC_REQUEST_SCHEMA = z.object({
	path: z.array(z.string()),
	args: z.array(z.unknown()),
})
export type RpcRequest = z.infer<typeof RPC_REQUEST_SCHEMA>

export const RPC_RESPONSE_SCHEMA = z.discriminatedUnion('status', [
	z.object({
		status: z.literal('ok'),
		data: z.unknown(),
	}),
	z.object({
		status: z.literal('invalid_input'),
		error: z.string(),
	}),
	z.object({
		status: z.literal('server_error'),
		error: z.string(),
	}),
])
export type RpcResponseSchema = z.infer<typeof RPC_RESPONSE_SCHEMA>
// #endregion ------------ RPC typing ------------

// #region ------------ Client ------------

export function _createRecursiveProxy(cb: Fn<[RpcRequest]>, path: string[]) {
	const proxy: unknown = new Proxy(noop, {
		get(_1, key) {
			if (typeof key !== 'string' || key === 'then') {
				return undefined
			}
			return _createRecursiveProxy(cb, [...path, key])
		},
		apply(_1, _2, args) {
			return cb({path, args})
		},
	})
	return proxy
}

export function createClientProxy<T>(cb: Fn<[RpcRequest]>) {
	return _createRecursiveProxy(cb, []) as DeepPromisify<T>
}

export interface FetchAdapterOpts {
	url?: string
	parse: (body: string) => unknown
	stringify: (obj: unknown) => string
}

export function fetchAdapter(fetch: typeof window.fetch, opts: FetchAdapterOpts) {
	const {url = '/rpc', ...cfg} = opts

	return async (rpcReq: RpcRequest) => {
		const resp = await fetch(`https://_${url}`, {
			method: 'POST',
			body: cfg.stringify(rpcReq),
		})
		const data = cfg.parse(await resp.text())
		const parsed = RPC_RESPONSE_SCHEMA.safeParse(data)

		if (!parsed.success) {
			throw new Error(`Error parsing response: ${parsed.error.message}`)
		}
		if (parsed.data.status !== 'ok') {
			throw new Error(`Failure response [${parsed.data.status}]: ${parsed.data.error}`)
		}
		return parsed.data.data
	}
}

// #endregion ------------ Client ------------

// #region ------------ Server ------------

export function routeRpcToObject(rpc: RpcRequest, obj: unknown): Promise<unknown> {
	const {args, path} = rpc

	let current = obj
	for (const key of path) {
		if (typeof current !== 'object' || current === null) {
			throw new Error(`Expected ${key} to be an object`)
		}
		if (!(key in current)) {
			throw new Error(`Expected ${key} to be in ${path.join('.')}`)
		}
		current = (current as any)[key]
	}

	if (typeof current !== 'function') {
		throw new Error(`Expected ${path} to be function, got ${typeof current}`)
	}
	return current(...args)
}

interface HttpRouteConfig {
	router: any
	parse: (body: string) => unknown
	stringify: (obj: unknown) => string
}

export async function routeHttpToObject(
	req: Request,
	cfg: HttpRouteConfig
): Promise<Response> {
	const body = await req.text()
	const rpcReq = RPC_REQUEST_SCHEMA.parse(cfg.parse(body))
	const routerResp = await routeRpcToObject(rpcReq, cfg.router)
	const resp: RpcResponseSchema = {status: 'ok', data: routerResp}

	return new Response(cfg.stringify(resp))
}

// #endregion ------------ Server ------------
