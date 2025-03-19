import 'dotenv/config'

import fs from 'fs'
import pino from 'pino'
import path from 'path'

import type { PluginReturnObject, PluginOnKey, PluginListener } from './types/plugin'

import boot from './modules/boot'

// Setup environment
const SERVER_NAME = process.env.SERVER_NAME || 'localhost'
const PORT = process.env.PORT || 1965
const STARTUP_MODULES = [boot]
const LISTENERS: Record<PluginOnKey, PluginListener[]> = {
  request: [],
  response: []
}

// Setup logger
const logger = pino({
  level: 'debug',
  transport: {
    target: process.env.ENVIRONMENT === 'development' ? 'pino-pretty' : 'console',
    options: {
      colorize: true
    }
  }
})

logger.info(`Gemini Dock: ${SERVER_NAME} on port ${PORT}`)
for (const mod of STARTUP_MODULES) {
  mod({ logger: logger.child({ module: mod.name }) })
}

if (process.env.PLUGINS) {
  const plugins = process.env.PLUGINS.split(',')
  for (const pluginPath of plugins) {
    try {
      const pluginPackage = JSON.parse(fs.readFileSync(path.join(pluginPath, 'package.json'), 'utf8'))
      const plugin = pluginPackage.name || pluginPath
      let main = 'index.js'
      if (!main) main = pluginPackage.main
      if (!main) main = pluginPackage.exports?.['.']
      if (!main) main = pluginPackage.module

      logger.info(`Loading plugin: ${plugin}`)
      const pluginModule = await import(path.join(pluginPath, main))
      const pluginReturn = await pluginModule.default({ logger: logger.child({ plugin }) }) as PluginReturnObject

      if (pluginReturn.success) {
        if (pluginReturn.on.request) LISTENERS.request.push(...pluginReturn.on.request)
        if (pluginReturn.on.response) LISTENERS.response.push(...pluginReturn.on.response)
      } else {
        logger.error(`Error loading plugin: ${pluginPath}`, pluginReturn.message)
      }
    } catch (error) {
      logger.error(`Error loading plugin: ${pluginPath}`, error)
    }
  }

  logger.info(`${LISTENERS.request.length} request listeners loaded`)
  logger.info(`${LISTENERS.response.length} response listeners loaded`)
}
