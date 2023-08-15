import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'
import {unstable_dev} from 'wrangler'

async function createWorker() {
	const worker = await unstable_dev('./src/durable.test-worker.ts', {
		persist: false,
		experimental: {disableExperimentalWarning: true, disableDevRegistry: true},
		durableObjects: [
			{
				class_name: 'Storage',
				name: 'STORAGE',
			},
		],
		logLevel: 'debug',
	})

	const client = createTRPCProxyClient({
		links: [
			httpBatchLink({
				url: '/trpc',
				fetch: worker.fetch,
			}),
		],
	})

	return Object.assign(worker, {trpc: client})
}

let worker
try {
	worker = await createWorker()

	const text = await worker.trpc.getName.query()
	console.log('TEXT1', text)
	const r = await worker.trpc.setName.mutate({first: 'jimmy'})
	console.log('set', r)
	const text2 = await worker.trpc.getName.query()
	console.log('TEXT2', text2)
} finally {
	await worker?.waitUntilExit()
	await worker?.stop()
}
