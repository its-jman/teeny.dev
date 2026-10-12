import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAI} from '@ai-sdk/openai'
import type {LanguageModel} from 'ai'
import {createWorkersAI} from 'workers-ai-provider'
import type {ModelInfo, Usage} from '../shared/api'

type ModelDef = {
	label: string
	provider: ModelInfo['provider']
	id: string
	// USD per million tokens. Workers AI: developers.cloudflare.com/workers-ai/platform/pricing
	// (checked 2026-10-12). Anthropic: list prices for the current models.
	inputPerM: number | null
	outputPerM: number | null
}

export const MODELS = {
	'llama-3.3-70b': {
		label: 'Llama 3.3 70B fast (Workers AI)',
		provider: 'workers-ai',
		id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
		inputPerM: 0.293,
		outputPerM: 2.253,
	},
	'llama-3.1-8b': {
		label: 'Llama 3.1 8B fast (Workers AI)',
		provider: 'workers-ai',
		id: '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
		inputPerM: 0.045,
		outputPerM: 0.384,
	},
	'llama-4-scout': {
		label: 'Llama 4 Scout 17B (Workers AI)',
		provider: 'workers-ai',
		id: '@cf/meta/llama-4-scout-17b-16e-instruct',
		inputPerM: 0.27,
		outputPerM: 0.85,
	},
	'gpt-oss-120b': {
		label: 'gpt-oss-120b (Workers AI)',
		provider: 'workers-ai',
		id: '@cf/openai/gpt-oss-120b',
		inputPerM: 0.35,
		outputPerM: 0.75,
	},
	'gpt-oss-20b': {
		label: 'gpt-oss-20b (Workers AI)',
		provider: 'workers-ai',
		id: '@cf/openai/gpt-oss-20b',
		inputPerM: 0.2,
		outputPerM: 0.3,
	},
	'qwen3-30b': {
		label: 'Qwen3 30B A3B (Workers AI)',
		provider: 'workers-ai',
		id: '@cf/qwen/qwen3-30b-a3b-fp8',
		inputPerM: 0.051,
		outputPerM: 0.335,
	},
	'glm-4.7-flash': {
		label: 'GLM 4.7 Flash (Workers AI)',
		provider: 'workers-ai',
		id: '@cf/zai-org/glm-4.7-flash',
		inputPerM: 0.06,
		outputPerM: 0.4,
	},
	'claude-haiku': {
		label: 'Claude Haiku 5.5',
		provider: 'anthropic',
		id: 'claude-haiku-5-5',
		inputPerM: 0.1,
		outputPerM: 0.5,
	},
	'claude-sonnet': {
		label: 'Claude Sonnet 5.5',
		provider: 'anthropic',
		id: 'claude-sonnet-5-5',
		inputPerM: 2,
		outputPerM: 10,
	},
	'claude-opus': {
		label: 'Claude Opus 5.5',
		provider: 'anthropic',
		id: 'claude-opus-5-5',
		inputPerM: 4,
		outputPerM: 20,
	},
} satisfies Record<string, ModelDef>

export type ModelKey = keyof typeof MODELS
export const DEFAULT_MODEL: ModelKey = 'llama-3.3-70b'

/** Allows ad-hoc ids without a code change: "openai:gpt-5-mini", "wai:@cf/...". */
function resolveDef(key: string): ModelDef {
	const known = (MODELS as Record<string, ModelDef>)[key]
	if (known) return known
	const [prefix, ...rest] = key.split(':')
	const id = rest.join(':')
	if (!id) throw new Error(`Unknown model: ${key}`)
	const provider = (
		{wai: 'workers-ai', anthropic: 'anthropic', openai: 'openai'} as const
	)[prefix as 'wai' | 'anthropic' | 'openai']
	if (!provider) throw new Error(`Unknown model provider prefix: ${prefix}`)
	return {label: key, provider, id, inputPerM: null, outputPerM: null}
}

function isAvailable(env: Env, provider: ModelInfo['provider']) {
	if (provider === 'anthropic') return !!env.ANTHROPIC_API_KEY
	if (provider === 'openai') return !!env.OPENAI_API_KEY
	return true
}

export function listModels(env: Env): ModelInfo[] {
	return Object.entries(MODELS).map(([key, m]) => ({
		key,
		label: m.label,
		provider: m.provider,
		available: isAvailable(env, m.provider),
		inputPerM: m.inputPerM,
		outputPerM: m.outputPerM,
	}))
}

export function getModel(env: Env, key: string): {model: LanguageModel; def: ModelDef} {
	const def = resolveDef(key)
	if (!isAvailable(env, def.provider)) {
		throw new Error(`Model ${key} needs ${def.provider.toUpperCase()}_API_KEY`)
	}
	switch (def.provider) {
		case 'workers-ai':
			return {model: createWorkersAI({binding: env.AI})(def.id), def}
		case 'anthropic':
			return {model: createAnthropic({apiKey: env.ANTHROPIC_API_KEY})(def.id), def}
		case 'openai':
			return {model: createOpenAI({apiKey: env.OPENAI_API_KEY})(def.id), def}
	}
}

export function costUsd(def: ModelDef, usage: Usage): number | null {
	if (def.inputPerM == null || def.outputPerM == null) return null
	return (usage.inputTokens * def.inputPerM + usage.outputTokens * def.outputPerM) / 1e6
}
