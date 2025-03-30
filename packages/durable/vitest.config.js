import {defineWorkersConfig} from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
	test: {
		typecheck: {enabled: true},
		poolOptions: {
			workers: {
				wrangler: {configPath: './test-worker/wrangler.json'},
			},
		},
	},
})
