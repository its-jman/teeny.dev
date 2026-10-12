import {defineConfig} from 'vitest/config'

// Unit tests for pure logic only (scoring). Strategies need real Workers AI, so they're
// exercised through the eval runner instead.
export default defineConfig({
	test: {include: ['src/**/*.test.ts']},
})
