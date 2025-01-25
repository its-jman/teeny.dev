import {defineWorkersConfig} from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
	test: {
		typecheck: true,
		onConsoleLog(log) {
			if (log.includes('__TEST_EXPECTED__')) return false
		},
		poolOptions: {
			workers: {
				wrangler: {configPath: './test-worker/wrangler.json'},
			},
		},
	},
})
