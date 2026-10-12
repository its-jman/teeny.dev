import {newWebSocketRpcSession, type RpcStub} from 'capnweb'
import type {PublicApi} from '../shared/api'

const TOKEN_KEY = 'voice-assistant-token'

export function getToken() {
	try {
		return localStorage.getItem(TOKEN_KEY) ?? ''
	} catch {
		return ''
	}
}

export function setToken(token: string) {
	try {
		localStorage.setItem(TOKEN_KEY, token)
	} catch {}
	reset()
}

let session: RpcStub<PublicApi> | null = null

function reset() {
	session?.[Symbol.dispose]()
	session = null
}

/** Shared WebSocket session; recreated on the next call after it breaks. */
export function api(): RpcStub<PublicApi> {
	if (!session) {
		const url = new URL('/rpc', location.href)
		url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
		const token = getToken()
		if (token) url.searchParams.set('token', token)
		const s = newWebSocketRpcSession<PublicApi>(url.toString())
		s.onRpcBroken(() => {
			if (session === s) session = null
		})
		session = s
	}
	return session
}
