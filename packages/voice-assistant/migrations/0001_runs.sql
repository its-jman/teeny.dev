-- One row per command handled, whichever strategy handled it.
CREATE TABLE runs (
	id TEXT PRIMARY KEY,
	created_at INTEGER NOT NULL,
	source TEXT NOT NULL, -- rpc | http | eval
	eval_id TEXT, -- groups rows from one eval sweep
	eval_case_id TEXT,
	strategy TEXT NOT NULL, -- decision | mcp | codemode
	model TEXT NOT NULL,
	input_kind TEXT NOT NULL, -- audio | text
	transcript TEXT NOT NULL,
	transcribe_ms REAL,
	route_ms REAL, -- decision model only
	llm_ms REAL,
	tool_ms REAL,
	total_ms REAL NOT NULL,
	input_tokens INTEGER,
	output_tokens INTEGER,
	cost_usd REAL,
	tool_calls TEXT NOT NULL, -- JSON array of {tool, args, ms}
	response TEXT,
	meta TEXT, -- JSON, strategy specific (route decision, generated code, ...)
	error TEXT,
	score REAL -- 0..1 when an expected outcome is known (eval cases)
);
CREATE INDEX runs_strategy_model ON runs (strategy, model, created_at);
CREATE INDEX runs_eval ON runs (eval_id);
