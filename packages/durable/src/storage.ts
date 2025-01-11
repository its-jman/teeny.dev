import {stringify as jsonStringify, parse as jsonParse} from 'superjson'
import type {TypeOf, ZodType} from 'zod'

export interface TypedStorageItem<T> {
	// get
	get(key: string, opts?: DurableObjectGetOptions): Promise<T | undefined>
	get(key: string[], opts?: DurableObjectGetOptions): Promise<Map<string, T>>
	// list
	list(opts?: DurableObjectListOptions): Promise<Map<string, T>>
	// put
	put(key: string, value: T, opts?: DurableObjectPutOptions): Promise<void>
	put(entries: Record<string, T>, opts?: DurableObjectPutOptions): Promise<void>
	// delete
	delete(key: string, opts?: DurableObjectPutOptions): Promise<boolean>
	delete(keys: string[], opts?: DurableObjectPutOptions): Promise<number>
}

type TypedStorageCfg = {[key: string]: ZodType}
type TypedStorageInterface<TCfg extends TypedStorageCfg> = {
	[K in keyof TCfg]: TypedStorageItem<TypeOf<TCfg[K]>>
}

// TODO: This whole thing is incredibly dumb, not typesafe, just dumb.
//   - how to even fix this? Build it without generics to assert
//     implementation, then force / assert into the non-generic version?
//   - Is there any way to actually do this safely with generics?
const createTypedStorageItem = <T extends ZodType>(
	storage: DurableObjectStorage,
	storagePrefix: string,
	validator: T
): TypedStorageItem<TypeOf<T>> => {
	const prefix = (val: string) => `${storagePrefix}##${val}`
	return {
		async get(keyOrKeys, opts) {
			if (typeof keyOrKeys === 'string') {
				const val = await storage.get<string>(prefix(keyOrKeys), opts)
				if (val === undefined) return val
				return validator.parse(jsonParse(val)) as any
			} else {
				const vals = await storage.get<string>(keyOrKeys.map(prefix), opts)
				const out = new Map()
				for (const [k, v] of vals) {
					const parsed = validator.safeParse(jsonParse(v))
					if (parsed.success) {
						out.set(k, parsed.data)
					}
				}
				return out
			}
		},
		async list(opts) {
			const items = await storage.list<string>({
				...opts,
				prefix: prefix(opts?.prefix ?? ''),
			})
			return new Map(
				[...items.entries()].map(([key, val]) => [key, validator.parse(jsonParse(val))])
			)
		},
		// TODO: idk how to represent this as overloaded...
		// TODO: idk how to represent this as overloaded...
		put(...args) {
			if (typeof args[0] === 'string') {
				const [key, _val, opts] = args as [string, unknown, DurableObjectPutOptions]
				const val = jsonStringify(validator.parse(_val))
				return storage.put<string>(prefix(key), val, opts)
			} else {
				const [_vals, opts] = args as [Record<string, string>, DurableObjectPutOptions]
				const vals: Record<string, TypeOf<T>> = {}
				for (const [key, _val] of Object.entries(_vals)) {
					const val = jsonStringify(validator.parse(_val))
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
		typedStorage[prefix] = createTypedStorageItem(storage, prefix, cfg[prefix]!)
	}

	// Assertion because idk how to do this in typescript...
	return Object.assign(storage, typedStorage as TypedStorageInterface<TCfg>)
}
