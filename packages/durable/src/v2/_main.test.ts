import {unstable_dev} from 'wrangler'
import type {UnstableDevWorker} from 'wrangler'
import {describe, beforeAll, afterAll, it, expect, beforeEach, afterEach} from 'vitest'

// Import to ensure the dependency is acknowledged by vitest
import './_main.test-worker.ts'

function createWorker() {
	return unstable_dev('./src/v2/_main.test-worker.ts', {
		persist: false,
		experimental: {disableExperimentalWarning: true, disableDevRegistry: true},
		durableObjects: [
			{
				class_name: 'Storage',
				name: 'STORAGE',
			},
		],
	})
}

describe('v2', () => {
	it('should build / run and return the stored data', async () => {
		let worker: UnstableDevWorker | undefined
		try {
			worker = await createWorker()
			const text = await (await worker.fetch('/get')).text()
			expect(text).toEqual('')
			await worker.fetch('/put/Jimmy')
			const text2 = await (await worker.fetch('/get')).text()
			expect(text2).toEqual('{"name":"/put/Jimmy"}')
		} finally {
			await worker?.waitUntilExit()
			await worker?.stop()
		}
	})
})
