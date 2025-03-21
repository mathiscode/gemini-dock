# Gemini Dock

An extensible Gemini server written in TypeScript.

> API is not stable yet; expect breaking changes on any upgrade.

There is an unfortunate problem in the tech world where a lot of projects want to be called Gemini. This project is in the ecosystem of the [Gemini protocol](https://geminiprotocol.net), unrelated to the exchange, Google AI, or any other Gemini.

- [Wikipedia](https://en.wikipedia.org/wiki/Gemini_(protocol))

- [Protocol Specification](https://geminiprotocol.net/docs/protocol-specification.gmi)

---

## Concepts

### Database

There is a SQLite database that is used to store the data for the Gemini Dock server. The schema is handled by the server, and sites can store arbitrary data in the metadata columns or in the `data` table. Alternatively, you can use the `event.data.db` object to modify the database structure directly.

Sites are expected to use the metadata columns to differentiate data between sites. There is no private data between sites, unless implemented by the site itself.

The current database schema can be found in the `packages/lib/schema/src/schema.ts` file.

- `users` - A table for storing user accounts
- `sessions` - A table for storing sessions
- `posts` - A table for storing posts
- `comments` - A table for storing comments on posts
- `messages` - A table for storing messages between users
- `notifications` - A table for storing notifications
- `likes` - A table for storing likes on posts
- `data` - A table for storing arbitrary data

### Modules

Modules are a way to extend the functionality of Gemini Dock at buildtime. Examples can be found in the `packages/modules` directory.

### Plugins

Plugins are a way to extend the functionality of Gemini Dock at runtime. Examples can be found in the `packages/plugins` directory.

### Sites

Sites are served by Gemini Dock. A site can be constructed in almost any way you want, as long as it exports a default object of routes, which are functions that return a response.

See the [example site](./packages/sites/localhost) for a full-featured example with authentication, posts, comments, messages, profiles, and more.

```js
export default {
  '/': event => {{ code: 20, type: 'text/gemini', body: 'Hello, world!\r\n=> /login Please login' }},

  '/login': event => {
    const { certificate, db, input, url } = event.data
    if (!certificate?.subject) return { code: 60, type: 'Certificate required for this route' }
    return { code: 20, type: 'text/gemini', body: 'Welcome back!' }
  },
}
```

For a better development experience, use the `@gemini-dock/protocol` and `@gemini-dock/types` packages:

```ts
import { CODES, respond } from '@gemini-dock/protocol'
import type { SiteOptions } from '@gemini-dock/types'

export default {
  '/': (event: SiteOptions) => respond(CODES.SUCCESS, 'text/gemini', 'Hello, world!'),
}
```

---

## Setup Certificates

The server will need a certificate for each site you want to serve, and they are stored in the `CERTS_PATH` environment variable path (or `./.certs` by default) with the subdirectory being the domain, e.g. `.certs/example.com`.

### Generate a Certificate

```bash
openssl req -new -key ./.certs/DOMAIN.TLD/private.key -out ./.certs/DOMAIN.TLD/csr.pem
openssl genrsa -out ./.certs/DOMAIN.TLD/private.key 2048
openssl x509 -req -days 365 -in ./.certs/DOMAIN.TLD/csr.pem -signkey ./.certs/DOMAIN.TLD/private.key -out ./.certs/DOMAIN.TLD/certificate.pem
```

---

## Development

```bash
# Clone the repository
git clone https://github.com/mathiscode/gemini-dock.git
cd gemini-dock
# Install dependencies
pnpm install
# Generate a certificate for localhost
pnpm run --filter @gemini-dock/server cert:complete
# Start the server and watch for changes
pnpm dev
```
