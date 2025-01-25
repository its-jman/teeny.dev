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

export function mapObject<T, U>(
	obj: T,
	callback: (value: T[keyof T], key: keyof T) => U
): {[K in keyof T]: U} {
	const result: Partial<{[K in keyof T]: U}> = {}
	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			result[key] = callback(obj[key], key)
		}
	}
	return result as {[K in keyof T]: U}
}
