import {unstable_dev} from 'wrangler'
import type {UnstableDevWorker} from 'wrangler'
import {describe, beforeAll, afterAll, it, expect, beforeEach, afterEach} from 'vitest'

// Import to ensure the dependency is acknowledged by vitest
import './durable.test-worker.ts'
import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'
import {AppRouter} from './durable.test-worker.ts'

type ThenArg<T> = T extends Promise<infer R> ? R : T

async function createWorker() {
	const worker = await unstable_dev('./src/durable.test-worker.ts', {
		persist: false,
		compatibilityDate: '2023-07-17',
		experimental: {disableExperimentalWarning: true, disableDevRegistry: true},
		durableObjects: [
			{
				class_name: 'Storage',
				name: 'STORAGE',
			},
		],
	})

	const workerFetch = worker.fetch.bind(worker) as unknown as typeof globalThis.fetch
	const client = createTRPCProxyClient<AppRouter>({
		links: [
			httpBatchLink({
				url: '/trpc',
				fetch: workerFetch,
			}),
		],
	})

	return Object.assign(worker, {trpc: client})
}

describe('durable', () => {
	it('should build / run and return the stored data', async () => {
		let worker: ThenArg<ReturnType<typeof createWorker>> | undefined
		try {
			worker = await createWorker()

			const text = await worker.trpc.getName.query()
			expect(text?.first).toEqual(undefined)
			await worker.trpc.setName.mutate({first: 'Jimmy'})
			const text2 = await worker.trpc.getName.query()
			expect(text2?.first).toEqual('Jimmy')

			const fallthrough = await worker.trpc.getFallthrough.query()
			expect(fallthrough).toEqual('Hello!')
		} finally {
			await worker?.waitUntilExit()
			await worker?.stop()
		}
	})
})
