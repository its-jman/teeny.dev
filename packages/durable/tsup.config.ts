import {defineConfig} from 'tsup'

export default defineConfig({
	entry: ['src/**/*.ts', '!src/**/*.{test,test-worker,test-lib}.ts'],
	outDir: './dist',
	bundle: false,
	format: ['esm'],
	clean: true,
	dts: true,
	sourcemap: true,

	/* outExtension({format}) {
		return {
			js: format === 'cjs' ? '.cjs' : format === 'esm' ? '.mjs' : undefined,
			dts: format === 'cjs' ? '.cts' : format === 'esm' ? '.mts' : undefined,
		}
	}, */
})
