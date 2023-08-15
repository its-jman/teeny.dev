import {z} from 'zod'

export const D1_VALIDATOR = z.custom<D1Database>(
	(val) => val && typeof (val as D1Database).prepare === 'function'
)
export const DURABLE_OBJECT_VALIDATOR = z.custom<DurableObjectNamespace>(
	(val) =>
		val &&
		typeof (val as DurableObjectNamespace).idFromName === 'function' &&
		typeof (val as DurableObjectNamespace).get === 'function' &&
		typeof (val as DurableObjectNamespace).idFromString === 'function'
)
