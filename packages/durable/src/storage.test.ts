import {env, runInDurableObject} from 'cloudflare:test'
import {describe, expect, expectTypeOf, it} from 'vitest'
import {getByName} from './utils'

describe('storage', () => {
	it('stores stuff', async () => {
		const stub = getByName(env.STORAGE_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			let one = await inst.storage.one.get('')
			expect(one).toBeUndefined()
			const url = 'https://test.com'
			await inst.storage.one.put('', {url})

			let many = await inst.storage.many.get('')
			expect(many).toBeUndefined()
			await inst.storage.many.put('', {title: 'ABC', description: 'CDE', id: 'TEST'})

			let none = await inst.storage.get('')
			expect(none).toBeUndefined()
			await inst.storage.put('', {myTest: 'TEST VALUE'})

			one = await inst.storage.one.get('')
			expect(one).not.toBeUndefined()
			expect(one?.url).eq(url)

			many = await inst.storage.many.get('')
			expect(many).not.toBeUndefined()
			expect(many?.id).eq('TEST')

			none = await inst.storage.get('')
			expect(none).not.toBeUndefined()
			expect(none).key('myTest')
			expect((none as {myTest: string})['myTest']).eq('TEST VALUE')

			expectTypeOf(one).toEqualTypeOf<{url: string} | undefined>()
			expectTypeOf(many).toEqualTypeOf<
				{title: string; description: string; id: string} | undefined
			>()
			expectTypeOf(none).toBeUnknown()
		})
	})
})
