# Gemini Dock

**An extensible Gemini server written in TypeScript**

See [gemini://dock.mathis.network](gemini://dock.mathis.network) for a demo of [@gemini-dock/site-dock](https://npmjs.com/package/@gemini-dock/site-dock) served by Gemini Dock.

> API is not stable until v1.0.0; expect breaking changes on any upgrade.

*There is an unfortunate problem in the tech world where a lot of projects want to be called Gemini. This project is in the ecosystem of the [Gemini protocol](https://geminiprotocol.net), unrelated to the exchange, Google AI, or any other Gemini product.*

## Gemini Protocol

[Excerpt from geminiprotocol.net](https://geminiprotocol.net):

> Gemini is a group of technologies similar to the ones that lie behind your familiar web browser. Using Gemini, you can explore an online collection of written documents which can link to other written documents. The main difference is that Gemini approaches this task with a strong philosophy of "keep it simple" and "less is enough". This allows Gemini to simply sidestep, rather than try and probably fail to solve, many of the problems plaguing the modern web, which just seem to get worse and worse no matter how many browser add-ons or well meaning regulations get thrown at them.

- [Protocol Specification](https://geminiprotocol.net/docs/protocol-specification.gmi)
- [Gemtext Specification](https://geminiprotocol.net/docs/gemtext-specification.gmi)
- [Wikipedia](https://en.wikipedia.org/wiki/Gemini_(protocol))

---

## Prerequisites

- Linux or macOS
- Node.js 20+
- openssl CLI

---

## Quick Start

```bash
cd /path/to/server/data
npx @gemini-dock/server certificate generate localhost
npx @gemini-dock/server site generate localhost
npx @gemini-dock/server migrate
npx @gemini-dock/server start
```

Then visit [`gemini://localhost`](gemini://localhost) to see the server in action.

## Installation

```bash
npm install -g @gemini-dock/server # or your package manager's equivalent
gemini-dock --help
```

## Upgrade

```bash
npm install -g @gemini-dock/server@latest
# or npx @gemini-dock/server@latest
gemini-dock migrate
```

---

## Concepts

### Sites

A site can be constructed in almost any way you want, as long as it exports a default object of routes, which are functions that return a response.

A route key should only be the top-level path, and you should handle subpaths in the route handler with the `options.url` object.

See the [Dock site source](./packages/sites/localhost) for a full-featured example with authentication, posts, comments, messages, profiles, and more.

A site can be very simple, here is the source for [`gemini://gem.mathis.network`](gemini://gem.mathis.network):

```js
const fs = require('fs')
const body = fs.readFileSync('sites/gem.mathis.network/index.gmi', 'utf8')

module.exports = {
  '/': async () => ({ code: 20, type: 'text/gemini', body })
}
```

Sites can also be installed from npm, like plugins:

```bash
gemini-dock site install <name> <domain>
```

To install [Dock](https://npmjs.com/package/@gemini-dock/site-dock) (`gemini://dock.mathis.network`), the default development community site, run:

```bash
gemini-dock site install @gemini-dock/site-dock localhost
npm i drizzle-orm # your server data directory will need this dependency
```

To customize the Dock site, you may edit the source directly or use environment variables:

```bash
export DOCK_SITE_NAME="My Community"
export DOCK_SITE_DESCRIPTION="A community for my users"
gemini-dock start
```

To uninstall a site, run:

```bash
gemini-dock site uninstall <name>
```

To generate a minimal site, run:

```bash
gemini-dock site generate <name>
```

```js
export default {
  '/': () => {{ code: 20, type: 'text/gemini', body: 'Hello, world!\r\n=> /login Please login' }},

  '/login': options => {
    const { certificate, db, input, url } = options
    // On non-success codes, "type" is our response content
    if (!certificate?.subject) return { code: 60, type: 'Certificate required for this route' }
    return { code: 20, type: 'text/gemini', body: 'Welcome back!' }
  },

  '/image': options => {
    const fs = require('fs')
    const image = fs.readFileSync('./image.png')
    return { code: 20, type: 'image/png', body: image }
  }
}
```

For a better development experience, use the [@gemini-dock/protocol](https://npmjs.com/package/@gemini-dock/protocol) and [@gemini-dock/types](https://npmjs.com/package/@gemini-dock/types) packages:

```ts
import { CODES, respond } from '@gemini-dock/protocol'
import type { SiteOptions } from '@gemini-dock/types'

export default {
  '/': (options: SiteOptions) => respond(CODES.SUCCESS, 'Hello, world!'),
  '/bad': (options: SiteOptions) => respond(CODES.FAIL_NOT_FOUND, 'Route not found'),
}
```

### Database

There is a SQLite database that is used to store data for sites. The schema is handled by the server, and sites can store arbitrary data in the `metadata` columns or in the `data` table.

Sites are expected to use the `site` column of each table to differentiate data between sites. There is no private data between sites, unless implemented by the site itself.

Sites can of course use their own database solution for more advanced use cases.

The current database schema can be found in the [packages/lib/schema/src/index.ts](packages/lib/schema/src/index.ts) file.

- `users` - A table for storing user accounts
- `sessions` - A table for storing sessions
- `posts` - A table for storing posts
- `comments` - A table for storing comments on posts
- `messages` - A table for storing messages between users
- `notifications` - A table for storing notifications
- `likes` - A table for storing likes on posts
- `data` - A table for storing arbitrary data

### Modules

Modules are a way to extend the functionality of Gemini Dock at buildtime. Examples can be found in the [packages/modules](./packages/modules) directory.

### Plugins

Plugins are a way to extend the functionality of Gemini Dock at runtime, and is simply a default export of a function that returns an object with listeners (see below). Examples can be found in the [packages/plugins](./packages/plugins) directory.

To install a plugin, run:

```bash
npx @gemini-dock/server plugin install <name>
```

To uninstall a plugin, run:

```bash
npx @gemini-dock/server plugin uninstall <name>
```

To generate a minimal plugin, run:

```bash
npx @gemini-dock/server plugin generate <name>
```

```js
export default function plugin(options) {
  return {
    on: {
      request: [(event) => {
        console.log(event.data)
        return {
          modifiedRequest: event.data.request
        }
      }],

      response: [(event) => {
        console.log(event.data)
        return {
          modifiedResponse: event.data.response
        }
      }]
    }
  }
}
```



---

## Setup Certificates

The server will need a certificate for each site you want to serve, and they are stored in the `CERTS_PATH` environment variable path (or `./.certs` by default) with the subdirectory being the domain, e.g. `.certs/example.com`. It should contain a `certificate.pem`, `csr.pem`, and `private.key` file.

### Generate a Certificate

```bash
gemini-dock certificate generate <domain>
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
