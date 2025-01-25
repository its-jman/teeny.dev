export const MIGRATIONS_SYMBOL = Symbol('teeny_durable_migrations')

export function getByName<T extends Rpc.DurableObjectBranded | undefined>(
	ns: DurableObjectNamespace<T>,
	name: string
) {
	return ns.get(ns.idFromName(name))
}

export function getById<T extends Rpc.DurableObjectBranded | undefined>(
	ns: DurableObjectNamespace<T>,
	id: string
) {
	return ns.get(ns.idFromString(id))
}

type MapValues<T, U> = {
	[K in keyof T]: U
}

export function mapObject<T extends object, U>(
	obj: T,
	fn: (value: T[keyof T], key: keyof T) => U
): MapValues<T, U> {
	const result = {} as MapValues<T, U>

	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			result[key] = fn(obj[key], key)
		}
	}

	return result
}
