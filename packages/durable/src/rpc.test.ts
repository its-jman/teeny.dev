import {
	describe,
	beforeAll,
	afterAll,
	it,
	expect,
	beforeEach,
	afterEach,
	vi,
} from 'vitest'
import {RpcRequest, createClientProxy, routeRpcToObject} from './rpc'

describe('RPC', () => {
	it('should build / run, match all types, and return the proper data', async () => {
		const router = {
			twiceNested: {
				val: 1234,
				v2() {},
				v3: {
					v4: () => 'v4 resp',
				},
				v5: {
					v6: {
						v7: () => ({resp: 'v7 resp'}),
					},
				},
			},
			test: async <T>(val: T) => val,
			user: {
				getUserById: (id: string) => '5678',
				ids: [1, 2, 3],
			},
		}

		const cb = vi.fn((rpc: RpcRequest) => routeRpcToObject(rpc, router))
		const routerProxy = createClientProxy<typeof router>(cb)

		routerProxy.twiceNested satisfies {
			v2: () => Promise<void>
			v3: {v4: () => Promise<string>}
		}
		expect(cb).toBeCalledTimes(0)

		// @ts-expect-error -- Even though v5 exists, it doesn't have any directly callable properties. Can this be improved?
		routerProxy.twiceNested.v5
		expect(cb).toBeCalledTimes(0)

		// @ts-expect-error - Even though user.ids exists, it's not a routable destination. Exclude it from obj
		routerProxy.user.ids[0]
		expect(cb).toBeCalledTimes(0)

		routerProxy.twiceNested.v2() satisfies Promise<void>
		expect(cb).toBeCalledTimes(1)
		expect(cb).toBeCalledWith({args: [], path: ['twiceNested', 'v2']})

		const v4Resp = await (routerProxy.twiceNested.v3.v4() satisfies Promise<string>)
		expect(cb).toBeCalledWith({args: [], path: ['twiceNested', 'v3', 'v4']})
		expect(v4Resp).toEqual('v4 resp')

		// Generic test - Router should have the generic. CURRENTLY BROKEN.
		// This will stay broken. https://discord.com/channels/508357248330760243/1132711361303023726/1132711361303023726
		// `typeof router` asserts generics to their lowest anscestor. This is a limitation of TypeScript.
		// const testAbc = await (routerProxy.test('abc') satisfies Promise<string>)
		// expect(cb).toBeCalledWith({args: ['abc'], path: ['test']})
		// expect(testAbc).toEqual('abc')

		routerProxy.user.getUserById('1234') satisfies Promise<string>
		expect(cb).toBeCalledWith({args: ['1234'], path: ['user', 'getUserById']})
	})
})
