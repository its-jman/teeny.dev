# @teeny.dev/durable

## Overview

`@teeny.dev/durable` is a library designed to simplify the management of Durable Objects in Cloudflare Workers. It provides utilities for creating typed storage and alarm management within Durable Objects.

## Installation

To install the package, use npm:

```sh
npm install @teeny.dev/durable
```

## Usage

### Typed Storage

The `createTypedStorage` function allows you to create a typed storage interface for your Durable Object.

```ts
import {createTypedStorage} from '@teeny.dev/durable'
import {z} from 'zod'

const MetaSchema = z.object({
	feedUrl: z.string(),
})
const BlogSchema = z.object({
	title: z.string(),
	description: z.string(),
	id: z.string(),
})

class FeedStorage extends DurableObject {
	storage

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.storage = createTypedStorage(state.storage, {
			meta: MetaSchema,
			blog: BlogSchema,
		})
	}

	// Usage:
	createBlogPost(title: string, description: string) {
		const id = crypto.randomUUID()
		await this.storage.blog.put(id, {title, description, id})
	}
}
```

### Alarm Manager

The `createAlarmManager` function helps you manage alarms within your Durable Object.

```ts
import {createAlarmManager} from '@teeny.dev/durable'
import {z} from 'zod'

const AlarmSchema = z.object({url: z.string()})
class FeedStorage extends DurableObject {
	alarm: AlarmManager<typeof AlarmSchema>

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.alarm = createAlarmManager({
			storage: state.storage,
			payloadParser: AlarmSchema,
			async handler(ctx) {},
		})
	}

	// Usage:
	createFeedSubscription(feedUrl: string) {
		await this.alarm.scheduleEvery(24 * 60 * 60 * 1000, {url: feedUrl})
	}
}
```

## Internal

### Testing

This package uses Vitest for testing. You can run the tests using the following commands:

```sh
npm run test:types
npm run test:vitest
```

### Scripts

- `gen:wrangler`: Generate Wrangler types.
- `build`: Build the project using tsup.
- `test:types`: Run TypeScript type checks.
- `test:vitest`: Run tests using Vitest.
- `test`: Run both type checks and tests.
- `release`: Release the package using release-it.

### License
