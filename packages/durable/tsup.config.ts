import {defineConfig} from 'tsup'

export default defineConfig({
	entry: ['src/**/*.ts', '!src/**/*.{test,test-worker,test-lib}.ts'],
	outDir: './dist',
	bundle: false,
	format: ['esm'],
	clean: true,
	dts: true,
	sourcemap: true,
})
