#! /usr/bin/env node

import fs from 'fs'
import { build } from 'esbuild'
import { execSync } from 'child_process'
import pluginPino from 'esbuild-plugin-pino'
import path from 'path'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
  banner: { js: '#!/usr/bin/env node\n' },
  define: {
    'process.env.VERSION': JSON.stringify(pkg.version)
  },
  plugins: [pluginPino({ transports: ['pino-pretty'] })]
})
.then(() => {
  try { fs.mkdirSync('dist/lib') } catch {}
  fs.copyFileSync('dist/thread-stream-worker.js', 'dist/lib/worker.js')
  fs.copyFileSync('dist/thread-stream-worker.js.map', 'dist/lib/worker.js.map')
  fs.copyFileSync('dist/pino-pretty.js', 'dist/lib/pino-pretty-transport.js')
  fs.copyFileSync('dist/pino-pretty.js.map', 'dist/lib/pino-pretty-transport.js.map')

  fs.renameSync('dist/index.js', 'dist/index.cjs')
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
