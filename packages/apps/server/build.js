#! /usr/bin/env node

import fs from 'fs'
import { build } from 'esbuild'
import { execSync } from 'child_process'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.cjs',
  bundle: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
  banner: { js: '#!/usr/bin/env node\n' },
  define: {
    'process.env.VERSION': JSON.stringify(pkg.version) // TODO: this didn't get updated in the previous build; check it
  }
})
.then(() => {
  execSync('chmod +x dist/index.cjs')
  execSync('cp -r .drizzle dist/')
  fs.copyFileSync('../../lib/schema/dist/index.js', 'dist/schema.js')
  fs.writeFileSync('dist/drizzle.config.js', `
    import 'dotenv/config'
    import { defineConfig } from 'drizzle-kit'

    export default defineConfig({
      out: './.drizzle',
      schema: './schema.js',
      dialect: 'sqlite',
      dbCredentials: {
        url: process.env.DB_FILE_NAME || 'file:../gemini-dock.db'
      }
    })
  `.trim())

  fs.writeFileSync('dist/migrate.package.json', `
    {
      "name": "gemini-dock-migrate",
      "version": "0.0.1",
      "private": true,
      "scripts": {
        "migrate": "drizzle-kit migrate"
      },
      "dependencies": {
        "@libsql/client": "latest",
        "dotenv": "latest",
        "drizzle-kit": "latest",
        "drizzle-orm": "latest"
      }
    }
  `.trim())

  console.log('Build successful')
})
.catch((err) => {
  console.error(err)
  process.exit(1)
})
