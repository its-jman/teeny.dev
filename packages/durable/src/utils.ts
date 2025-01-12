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
