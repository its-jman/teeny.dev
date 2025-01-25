import {
	createExecutionContext,
	env,
	runInDurableObject,
	waitOnExecutionContext,
} from 'cloudflare:test'
import {describe, expect, expectTypeOf, it} from 'vitest'
import {getByName} from './utils'
import {prepareSqlite, stmt, type Migration} from './sql'

const BASIC_CONFIG: {[K: string]: Migration} = {
	seal: {
		commands: [
			`CREATE TABLE pasta (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, wheatiness TEXT NOT NULL)`,
			'INSERT INTO pasta (name, wheatiness) VALUES ("spaghetti", "whole wheat"), ("cavatappi", "plain ole"), ("lasagne", "plain ole")',
		],
	},
	makeDinner: {
		description: 'Add easiness indicator out of 10',
		commands: [`ALTER TABLE pasta ADD easiness INTEGER NOT NULL DEFAULT -1`],
	},
}

const BASIC_PLUS: {[K: string]: Migration} = {
	curiousDessert: {
		description: 'Add more pasta configs',
		commands: [
			'ALTER TABLE pasta ADD weight INTEGER NOT NULL DEFAULT ""',
			'INSERT INTO pasta (name, wheatiness, weight) VALUES ("mini shell", "super juiced", 3), ("spiral", "thin ripped", 6)',
		],
	},
}

/**
 * Describes Migrations:
 * 	- Creates a migrations table (with proper columns)
 * 		- This is done using the same mechanism as regular migrations?
 * 		- Can I start this now without that? What would be the impact / reality if I eventually add a second migration?
 * 		- Does the table structure change with multiple sources of migrations?
 *
 * 	- When run:
 * 	  - Properly runs migrations (in the correct order)
 * 	  - Inserts proper items into migrations table
 * 		- Starts at the correct place when re-running with new migrations
 * 		- Ignores when re-running with NO new migrations
 * 		- Errs:
 * 			- With missing migrations
 * 			- (removed for now) With mismatched run orders
 * 			- With mismatched hash's
 */
describe('sql - migrations', () => {
	it('creates migrations table with internal migrations added', async () => {
		const stub = getByName(env.SQL_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			prepareSqlite(inst.ctx, {migrations: {}})

			const columns = inst.ctx.storage.sql
				.exec<{name: string; type: string}>("pragma table_info('__teeny_migrations')")
				.toArray()

			expect(columns[0]).toHaveProperty('name', 'id')
			expect(columns[1]).toHaveProperty('name', 'key')
			expect(columns[2]).toHaveProperty('name', 'run_order')
			expect(columns[3]).toHaveProperty('name', 'description')
			expect(columns[4]).toHaveProperty('name', 'hash')
			expect(columns[5]).toHaveProperty('name', 'date')

			expect(columns[0]).toHaveProperty('type', 'INTEGER')
			expect(columns[1]).toHaveProperty('type', 'TEXT')
			expect(columns[2]).toHaveProperty('type', 'INTEGER')
			expect(columns[3]).toHaveProperty('type', 'TEXT')
			expect(columns[4]).toHaveProperty('type', 'TEXT')
			expect(columns[5]).toHaveProperty('type', 'TEXT')

			const migrations = inst.ctx.storage.sql
				.exec("SELECT * FROM __teeny_migrations WHERE key LIKE '_teeny_sql%'")
				.toArray()
			expect(migrations).toHaveLength(1)
			expect(migrations[0]).toHaveProperty('key', '_teeny_sql$$initalize')
			expect(migrations[0]).toHaveProperty('description', 'Initalize migrations table')
		})
	})

	it('runs batch of migrations', async () => {
		const stub = getByName(env.SQL_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			prepareSqlite(inst.ctx, {migrations: BASIC_CONFIG})

			const migrations = inst.ctx.storage.sql
				.exec("SELECT * FROM __teeny_migrations WHERE key LIKE 'user%'")
				.toArray()
			expect(migrations).toHaveLength(2)
			expect(migrations[0]).toHaveProperty('key', 'user$$seal')
			expect(migrations[0]).toHaveProperty('run_order', 0)
			expect(migrations[0]).toHaveProperty('description', '')

			expect(migrations[1]).toHaveProperty('key', 'user$$makeDinner')
			expect(migrations[1]).toHaveProperty('run_order', 1)
			expect(migrations[1]).toHaveProperty(
				'description',
				'Add easiness indicator out of 10'
			)

			const pasta = inst.ctx.storage.sql.exec('SELECT * FROM pasta').toArray()
			expect(pasta).toHaveLength(3)
		})
	})

	it('runs batch, with additional migration afterwards', async () => {
		const stub = getByName(env.SQL_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			prepareSqlite(inst.ctx, {migrations: BASIC_CONFIG})
			prepareSqlite(inst.ctx, {
				migrations: {
					...BASIC_CONFIG,
					...BASIC_PLUS,
				},
			})

			const items = inst.ctx.storage.sql.exec('SELECT * FROM pasta').toArray()
			expect(items).toHaveLength(5)

			prepareSqlite(inst.ctx, {
				migrations: {
					...BASIC_CONFIG,
					...BASIC_PLUS,
					interestingChoices: {
						description: 'Add more pasta configs pt 2',
						commands: [
							'INSERT INTO pasta (name, wheatiness, weight) VALUES ("angel hair", "gentle breezy", 1), ("fusilli", "thin ripped", 6)',
						],
					},
				},
			})

			const items2 = inst.ctx.storage.sql.exec('SELECT * FROM pasta').toArray()
			expect(items2).toHaveLength(7)
		})
	})

	it("runs batch, doesn't rerun unnecessarily", async () => {
		const stub = getByName(env.SQL_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			prepareSqlite(inst.ctx, {migrations: BASIC_CONFIG})
			prepareSqlite(inst.ctx, {migrations: {...BASIC_CONFIG, ...BASIC_PLUS}})

			const items = inst.ctx.storage.sql.exec('SELECT * FROM pasta').toArray()
			expect(items).toHaveLength(5)

			prepareSqlite(inst.ctx, {migrations: {...BASIC_CONFIG, ...BASIC_PLUS}})

			const items2 = inst.ctx.storage.sql.exec('SELECT * FROM pasta').toArray()
			expect(items2).toHaveLength(5)
		})
	})

	it('runs batch, 2nd unrelated batch', async () => {
		const stub = getByName(env.SQL_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			prepareSqlite(inst.ctx, {migrations: BASIC_CONFIG})
			expect(() => {
				prepareSqlite(inst.ctx, {migrations: {...BASIC_PLUS}})
			}).toThrowError('Migration config missing entries')
		})
	})

	it('runs batch, 2nd with unknown migration as first migration in list', async () => {
		const stub = getByName(env.SQL_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			prepareSqlite(inst.ctx, {migrations: BASIC_CONFIG})
			expect(() => {
				prepareSqlite(inst.ctx, {migrations: {...BASIC_PLUS, ...BASIC_CONFIG}})
			}).toThrowError("Hash doesn't match")
		})
	})

	it('runs batch, 2nd with invalid content', async () => {
		const stub = getByName(env.SQL_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			prepareSqlite(inst.ctx, {migrations: BASIC_CONFIG})

			expect(() => {
				prepareSqlite(inst.ctx, {
					migrations: {
						seal: BASIC_CONFIG['seal']!,
						makeDinner: BASIC_CONFIG['seal']!,
					},
				})
			}).toThrowError("Hash doesn't match")
		})
	})
})

/**
 * Describes Statements:
 * 	- Maps statements to prepared statements, typesafe
 * 	- Allows mapping of statement to expected return type
 * 	- Works properly with / without parameters
 */
describe('sql - statements', () => {
	it('types properly, and queries expected values', async () => {
		const stub = getByName(env.SQL_TEST, 'main')

		await runInDurableObject(stub, async (inst) => {
			const sql = prepareSqlite(inst.ctx, {
				migrations: {
					init: [
						'CREATE TABLE pasta (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, key TEXT)',
						'INSERT INTO pasta (name, key) VALUES ("abc", "xyz"), ("cde", "wxy"), ("def", "vwx"), ("efg", "uvw")',
					],
				},
				statements: {
					plainOle: 'SELECT * FROM pasta',
					simpleReturn: stmt<{'count(*)': number}>('SELECT count(*) FROM pasta'),
					complexArgs: stmt<Record<string, string>, [number, string]>(
						'SELECT * FROM pasta WHERE id = ? AND name = ?'
					),
				},
			})

			const plain = sql.plainOle().toArray()
			expect(plain).toHaveLength(4)

			const simple = sql.simpleReturn().one()
			expect(simple['count(*)']).eq(4)

			const complex = sql.complexArgs(3, 'def').one()
			expect(complex).toBeTruthy()
			expect(complex.key).eq('vwx')

			expectTypeOf(sql.plainOle).toEqualTypeOf<
				() => SqlStorageCursor<Record<string, string>>
			>()
			expectTypeOf(sql.simpleReturn).toEqualTypeOf<
				() => SqlStorageCursor<{'count(*)': number}>
			>()
			expectTypeOf(sql.complexArgs).toEqualTypeOf<
				(a: number, b: string) => SqlStorageCursor<Record<string, string>>
			>()
		})
	})
})
