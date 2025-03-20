import 'dotenv/config'

import fs from 'fs'
import path from 'path'

import boot from '@gemini-dock/module-boot'
import type { PluginReturnObject, PluginOnKey, PluginListener } from '@gemini-dock/types'

import createServer from './server'
import logger from './logger'

// Setup server
const SERVER_NAME = process.env.SERVER_NAME || 'localhost'
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 1965
const HOST = process.env.HOST || '0.0.0.0'
const BACKLOG = process.env.BACKLOG ? parseInt(process.env.BACKLOG) : 511
const PLUGINS_PATH = process.env.PLUGINS_PATH || 'plugins'

const STARTUP_MODULES = [boot]

const PLUGIN_LISTENERS: Record<PluginOnKey, PluginListener[]> = { request: [], response: [] }

// Load plugins first so we have listeners ready before creating the server
if (PLUGINS_PATH) {
  const plugins = fs.readdirSync(path.join(process.cwd(), PLUGINS_PATH))
  for (const pluginPath of plugins) {
    try {
      const pluginPackage = JSON.parse(fs.readFileSync(path.join(process.cwd(), PLUGINS_PATH, pluginPath, 'package.json'), 'utf8'))
      const plugin = pluginPackage.name || pluginPath

      let main
      if (!main) main = pluginPackage.exports?.['.']
      if (!main) main = pluginPackage.main
      if (!main) main = pluginPackage.module
      if (!main) main = 'index.js'

      import(path.join(process.cwd(), PLUGINS_PATH, pluginPath, main))
        .then(pluginModule => pluginModule.default({ logger: logger.child({ plugin }) }))
        .then((pluginReturn: PluginReturnObject) => {
          if (pluginReturn.success) {
            if (pluginReturn.on.request) PLUGIN_LISTENERS.request.push(...pluginReturn.on.request)
            if (pluginReturn.on.response) PLUGIN_LISTENERS.response.push(...pluginReturn.on.response)
            logger.info(`Plugin ${plugin} loaded successfully${pluginReturn.message ? `: ${pluginReturn.message}` : ''}`)
          } else {
            logger.error(`Error loading plugin: ${pluginPath}`)
            logger.error(pluginReturn.message)
          }
        })
        .catch(error => {
          logger.error(`Error loading plugin: ${pluginPath}`)
          logger.error(error)
        })
    } catch (error) {
      logger.error(`Error loading plugin: ${pluginPath}`)
      logger.error(error)
    }
  }
}

const SERVER = createServer(PLUGIN_LISTENERS.request, PLUGIN_LISTENERS.response)
if (!SERVER) {
  logger.error('Failed to create server')
  process.exit(1)
}

SERVER.on('error', (error) => {
  logger.error(error)
  if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use`)
    process.exit(1)
  }
})

SERVER.listen(PORT, HOST, BACKLOG, () => {
  logger.info(`${SERVER_NAME} listening on ${HOST}:${PORT}`)
  // @ts-expect-error - TODO: fix this
  for (const mod of STARTUP_MODULES) mod.default({ logger: logger.child({ module: mod.name }) })
  logger.info(`${PLUGIN_LISTENERS.request.length} request listeners loaded`)
  logger.info(`${PLUGIN_LISTENERS.response.length} response listeners loaded`)
})

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...')
  SERVER.close(() => {
    logger.info('Server closed')
  })
})

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...')
  SERVER.close(() => {
    logger.info('Server closed')
  })
})

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception')
  logger.error(error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection')
  logger.error(reason)
  logger.error(promise)
  process.exit(1)
})

process.on('exit', () => {
  logger.info('Exiting...')
})
