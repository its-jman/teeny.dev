export function getByName<T extends Rpc.DurableObjectBranded | undefined>(
	ns: DurableObjectNamespace<T>,
	name: string
) {
	return ns.get(ns.idFromName(name))
}
