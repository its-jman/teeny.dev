import type {D1Migration} from 'cloudflare:test'
import {mapObject, MIGRATIONS_SYMBOL} from './utils'

// #region types
export type Migration =
	| Array<string>
	| {
			description?: string
			commands: Array<string>
	  }

export type Stmt<T, TArgs extends Array<any> | undefined> = {
	command: string
	__args: TArgs
	__resp: T
}
type StmtFn<T extends Stmt<any, any>> = (...args: T['__args']) => T['__resp']

export type PrepareSqlCfg<T> = {
	migrations?: {[K: string]: Migration}
	statements?: {[A in keyof T]: string | Stmt<any, Array<any>>}
}
// #endregion

// #region migrations
// async function hashMessage(message: string) {
// 	const msgUint8 = new TextEncoder().encode(message) // encode as (utf-8) Uint8Array
// 	const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8) // hash the message
// 	const hashArray = Array.from(new Uint8Array(hashBuffer)) // convert buffer to byte array
// 	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('') // convert bytes to hex string
// 	return hashHex
// }
function hashMessage(msg: string) {
	let hash = 0
	for (let i = 0; i < msg.length; i++) {
		const char = msg.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash |= 0 // Convert to 32-bit integer
	}
	return hash.toString(36) // Shortens the hash
}

// Don't implement yet. Assume migrations are either succeed or fail?
async function tryWithRollback(ctx: DurableObjectState, fn: () => void | Promise<void>) {
	const bkmk = await ctx.storage.getCurrentBookmark()
	try {
		await fn()
	} finally {
		await ctx.storage.onNextSessionRestoreBookmark(bkmk)
		ctx.abort()
	}
}

/**
 * Order of operations:
 * 	- run migrations
 * 	- insert migration status
 *
 * Condition is migrations table needs to be up to date before inserting anything
 * Need to figure out ordering to iterate migrations
 */
function runMigrations(
	prefix: string,
	ctx: DurableObjectState,
	migrations: Record<string, Migration>
) {
	let prevRuns = null
	try {
		prevRuns = ctx.storage.sql
			.exec<{key: string; run_order: number; hash: string}>(
				`SELECT * FROM __teeny_migrations WHERE key LIKE "${prefix}%"`
			)
			.toArray()
	} catch {}

	const migrationsArr = [...Object.entries(migrations)]
	const dateStr = new Date().toISOString()

	/**
	 * Validation:
	 * 	- Confirm matching ordering (let i=0)
	 *  - Confirm matching hash
	 *  - Confirm no missing migrations
	 */
	if ((prevRuns?.length ?? 0) > migrationsArr.length) {
		throw new Error('Bad migration config: Migration config missing entries')
	}

	for (let i = 0; i < migrationsArr.length; i += 1) {
		const [__key, migration] = migrationsArr[i]!
		const key = `${prefix}$$${__key}`

		const commands = (Array.isArray(migration) ? migration : migration.commands).join(';')
		const hash = hashMessage(commands)

		if (prevRuns && i < prevRuns.length) {
			const prevRun = prevRuns[i]!
			// This is always going to match, never error. We could be smarter and lookup ordering, but for now just leave it.
			/* if (prevRun.run_order !== i) {
				throw new Error("Bad migration config: Run order doesn't match")
			} else  */
			if (prevRun.hash !== hash) {
				throw new Error("Bad migration config: Hash doesn't match")
			}

			continue
		}

		ctx.storage.sql.exec(commands)
		ctx.storage.sql.exec(
			'INSERT INTO __teeny_migrations (key, run_order, description, hash, date) VALUES (?, ?, ?, ?, ?)',
			key,
			i,
			Array.isArray(migration) ? '' : migration.description ?? '',
			hash,
			dateStr
		)
	}
}

function initalizeMigrationsTable(ctx: DurableObjectState) {
	runMigrations('_teeny_sql', ctx, {
		initalize: {
			description: 'Initalize migrations table',
			commands: [
				`CREATE TABLE IF NOT EXISTS __teeny_migrations (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					key TEXT NOT NULL UNIQUE,
					run_order INTEGER NOT NULL,
					description TEXT NOT NULL,
					hash TEXT NOT NULL,
					date TEXT NOT NULL
	 			)`,
				'CREATE INDEX IF NOT EXISTS __teeny_migrations_key ON __teeny_migrations (key)',
			],
		},
	})
}
// #endregion migrations

// #region statements

export function stmt<
	T extends Record<string, SqlStorageValue>,
	TArgs extends Array<any> = []
>(command: string): Stmt<T, TArgs> {
	return {
		command,
		__resp: undefined as unknown as T,
		__args: undefined as unknown as TArgs,
	}
}

type StmtFnVal<T extends string | Stmt<any, any>> = T extends Stmt<any, any>
	? (...args: T['__args']) => SqlStorageCursor<T['__resp']>
	: () => SqlStorageCursor<Record<string, string>>

function mapStatements<T extends {[K in keyof T]: string | Stmt<any, any>}>(
	ctx: DurableObjectState,
	stmts: T
): {
	[K in keyof T]: StmtFnVal<T[K]>
} {
	// @ts-expect-error not sure how to properly type
	return mapObject(stmts, (stmt) => {
		if (typeof stmt === 'string') {
			return () => ctx.storage.sql.exec(stmt)
		} else {
			return (...args: typeof stmt.__args) =>
				ctx.storage.sql.exec<typeof stmt.__resp>(stmt.command, ...args)
		}
	})
}

// #endregion statements

/**
 * https://www.tldraw.com/ro/p5gCE_QTJo9CrCgx2n50I?d=v40.60.1647.913.page
 */
export function prepareSqlite<T extends {[K in keyof T]: string | Stmt<any, any>}>(
	ctx: DurableObjectState,
	cfg: {
		migrations?: Record<string, Migration>
		statements?: T
	}
) {
	const sql = ctx.storage.sql

	if (cfg.migrations) {
		initalizeMigrationsTable(ctx)
		runMigrations('user', ctx, cfg.migrations)
	}

	return Object.assign(sql, mapStatements(ctx, cfg.statements))
}
