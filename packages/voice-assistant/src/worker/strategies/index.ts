import type {Strategy} from '../../shared/api'
import {runCodemode} from './codemode'
import {runDecision} from './decision'
import {runMcp} from './mcp'
import type {StrategyInput, StrategyOutput} from './shared'

export const strategies: Record<
	Strategy,
	(input: StrategyInput) => Promise<StrategyOutput>
> = {
	decision: runDecision,
	mcp: runMcp,
	codemode: runCodemode,
}

export const DEFAULT_MODELS: Record<Strategy, string> = {
	// Arg extraction for a single, already-chosen tool: a small model is enough.
	decision: 'llama-3.1-8b',
	mcp: 'llama-3.3-70b',
	codemode: 'llama-3.3-70b',
}
