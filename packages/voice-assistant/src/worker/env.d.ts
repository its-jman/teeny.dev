// Optional secrets, not declared in wrangler.jsonc so `wrangler types` doesn't emit them.
interface Env {
	ANTHROPIC_API_KEY?: string
	OPENAI_API_KEY?: string
	/** When set, /rpc, /api and /mcp require `Authorization: Bearer <token>` or `?token=`. */
	API_TOKEN?: string
}
