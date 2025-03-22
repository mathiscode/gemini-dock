import 'dotenv/config'

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { program } from 'commander'
import { drizzle } from 'drizzle-orm/libsql'

import boot from '@gemini-dock/module-boot'
import * as schema from '@gemini-dock/schema'
import type { PluginReturnObject, PluginOnKey, PluginListener } from '@gemini-dock/types'

import createServer from './server'
import logger from './logger'

const defaultDbFile = process.env.DB_FILE_NAME || 'file:gemini-dock.db'

program
  .name('gemini-dock')
  .description('An extensible Gemini Server written in TypeScript')
  .version(process.env.VERSION || '?.?.?')

// Start server command (default)
program
  .command('start', { isDefault: true })
  .description('Start the Gemini Dock server')
  .option('-n, --name <name>', 'server name', process.env.SERVER_NAME || 'Gemini Dock')
  .option('-p, --port <number>', 'port to listen on', val => parseInt(val), process.env.PORT ? parseInt(process.env.PORT) : 1965)
  .option('-h, --host <address>', 'host to listen on', process.env.HOST || '0.0.0.0')
  .option('-b, --backlog <number>', 'connection backlog size', val => parseInt(val), process.env.BACKLOG ? parseInt(process.env.BACKLOG) : 511)
  .option('--plugins-path <path>', 'path to plugins directory', process.env.PLUGINS_PATH || 'plugins')
  .option('--sites-path <path>', 'path to sites directory', process.env.SITES_PATH || 'sites')
  .option('--db-file <filename>', 'database file name', defaultDbFile)
  .action((options) => { startServer(options) })

program
  .command('migrate')
  .description('Output migration files')
  .action(() => {
    try {
      execSync(`mkdir -p ${path.join(process.cwd(), '.migration')}`)
      execSync(`cp -r ${path.join(__dirname, '.drizzle')} ${path.join(process.cwd(), '.migration', '.drizzle')}`)
      execSync(`cp ${path.join(__dirname, 'schema.js')} ${path.join(process.cwd(), '.migration', 'schema.js')}`)
      execSync(`cp ${path.join(__dirname, 'drizzle.config.js')} ${path.join(process.cwd(), '.migration', 'drizzle.config.js')}`)
      execSync(`cp ${path.join(__dirname, 'migrate.package.json')} ${path.join(process.cwd(), '.migration', 'package.json')}`)
      console.log('Installing migration dependencies...')
      execSync(`cd ${path.join(process.cwd(), '.migration')} && npm install && npm run migrate ; cd ..`)
      console.log('Migration files updated!')
    } catch (error) {
      console.error(`Error copying migration files: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

// Certificate commands
const certificateCommand = program
  .command('certificate')
  .description('Manage certificates')
  .option('--certs-path <path>', 'path to certificates directory', process.env.CERTS_PATH || '.certs')

certificateCommand
  .action(() => {
    console.log('Usage: gemini-dock certificate [command]')
    console.log('')
    console.log('Commands:')
    console.log('  list                    List all certificates')
    console.log('  generate <domain>       Generate a certificate for a domain')
    console.log('')
    console.log('Options:')
    console.log('  --certs-path <path>     Path to certificates directory')
    console.log('')
    console.log('Run `gemini-dock certificate <command> --help` for more information on a command.')
  })

certificateCommand
  .command('list')
  .description('List all certificates')
  .action((options) => {
    // Get options from parent command if not specified in this command
    const certsPath = options.certsPath || certificateCommand.opts().certsPath
    try {
      const certs = fs.readdirSync(path.join(process.cwd(), certsPath))
      console.log(`Available certificates in ${certsPath}:`)
      
      if (certs.length === 0) {
        console.log('No certificates found')
        return
      }
      
      certs.forEach(cert => {
        console.log(`- ${cert}`)
      })
    } catch (error) {
      console.error(`Error listing certificates: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

certificateCommand
  .command('generate <domain>')
  .description('Generate a certificate for a domain')
  .action(async (domain, options) => {
    // Get options from parent command if not specified in this command
    const certsPath = options.certsPath || certificateCommand.opts().certsPath
    console.log(`Generating certificate for ${domain}...`)

    // Create certificates directory and domain directory
    const domainCertPath = path.join(process.cwd(), certsPath, domain)
    
    try {
      if (!fs.existsSync(path.join(process.cwd(), certsPath))) fs.mkdirSync(path.join(process.cwd(), certsPath), { recursive: true })
      if (!fs.existsSync(domainCertPath)) fs.mkdirSync(domainCertPath, { recursive: true })

      // 1. Generate private key
      console.log('Generating private key...')
      const { spawn } = await import('child_process')
      const genKey = spawn('openssl', [
        'genrsa',
        '-out', path.join(domainCertPath, 'private.key'),
        '2048'
      ])

      await new Promise((resolve, reject) => {
        genKey.on('close', code => {
          if (code === 0) resolve(null)
          else reject(new Error(`openssl genrsa failed with code ${code}`))
        })
        genKey.stderr.on('data', data => console.error(data.toString()))
      })

      // 2. Create CSR
      console.log('Creating certificate signing request...')
      const csrArgs = [
        'req', '-new',
        '-key', path.join(domainCertPath, 'private.key'),
        '-out', path.join(domainCertPath, 'csr.pem'),
        '-subj', `/CN=${domain}/C=US/ST=New York/L=New York/O=Gemini Dock/OU=Development`
      ]
      
      const genCsr = spawn('openssl', csrArgs)
      
      await new Promise((resolve, reject) => {
        genCsr.on('close', code => {
          if (code === 0) resolve(null)
          else reject(new Error(`openssl req failed with code ${code}`))
        })
        genCsr.stderr.on('data', data => console.error(data.toString()))
      })

      // 3. Sign the certificate
      console.log('Signing certificate...')
      const signArgs = [
        'x509', '-req',
        '-days', '365',
        '-in', path.join(domainCertPath, 'csr.pem'),
        '-signkey', path.join(domainCertPath, 'private.key'),
        '-out', path.join(domainCertPath, 'certificate.pem')
      ]
      
      const signCert = spawn('openssl', signArgs)
      
      await new Promise((resolve, reject) => {
        signCert.on('close', code => {
          if (code === 0) resolve(null)
          else reject(new Error(`openssl x509 failed with code ${code}`))
        })
        signCert.stderr.on('data', data => console.error(data.toString()))
      })

      console.log(`Certificate for ${domain} generated successfully at ${domainCertPath}`)
    } catch (error) {
      console.error(`Error generating certificate: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

// List plugins command
const pluginsCommand = program
  .command('plugin')
  .description('Manage plugins')
  .option('--plugins-path <path>', 'path to plugins directory', process.env.PLUGINS_PATH || 'plugins')
  .action(() => {
    console.log('Usage: gemini-dock plugin [command]')
    console.log('')
    console.log('Commands:')
    console.log('  list                    List all plugins')
    console.log('  install <name>          Install a plugin')
    console.log('  uninstall <name>        Uninstall a plugin')
    console.log('  generate <name>         Generate a plugin')
    console.log('')
    console.log('Options:')
    console.log('  --plugins-path <path>   Path to plugins directory')
    console.log('')
    console.log('Run `gemini-dock plugin <command> --help` for more information on a command.')
  })

pluginsCommand
  .command('list')
  .description('List all plugins')
  .action((options) => {
    const pluginsPath = options.pluginsPath || pluginsCommand.opts().pluginsPath
    try {
      if (!fs.existsSync(path.join(process.cwd(), pluginsPath))) {
        console.log(`Plugins path ${pluginsPath} does not exist`)
        return
      }

      const plugins = fs.readdirSync(path.join(process.cwd(), pluginsPath))
      console.log(`Available plugins in ${pluginsPath}:`)
      
      if (plugins.length === 0) {
        console.log('No plugins found')
        return
      }
      
      plugins.forEach(pluginPath => {
        try {
          const packagePath = path.join(process.cwd(), pluginsPath, pluginPath, 'package.json')
          if (fs.existsSync(packagePath)) {
            const pluginPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
            console.log(`- ${pluginPackage.name || pluginPath}: ${pluginPackage.description || 'No description'}`)
          } else {
            console.log(`- ${pluginPath} (No package.json found)`)
          }
        } catch (error) {
          console.log(`- ${pluginPath} (Error reading plugin info)`)
        }
      })
    } catch (error) {
      console.error(`Error listing plugins: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

pluginsCommand
  .command('install <name>')
  .description('Install a plugin')
  .action((name, options) => {
    console.log(`Installing plugin ${name}...`)
    const pluginsPath = options.pluginsPath || pluginsCommand.opts().pluginsPath
    if (!fs.existsSync(path.join(process.cwd(), pluginsPath))) {
      fs.mkdirSync(path.join(process.cwd(), pluginsPath), { recursive: true })
    }

    const tmpPath = path.join(os.tmpdir(), 'gemini-dock-npm-install-${name}')
    execSync(`npm install ${name} -g --prefix ${tmpPath}`)
    execSync(`cp -r ${tmpPath}/lib/node_modules/${name} ${path.join(process.cwd(), pluginsPath, name)}`)
    execSync(`rm -rf ${tmpPath}`)
    execSync(`cd ${path.join(process.cwd(), pluginsPath, name)} && npm install ; cd..`)
  })

pluginsCommand
  .command('uninstall <name>')
  .description('Uninstall a plugin')
  .action((name, options) => {
    console.log(`Uninstalling plugin ${name}...`)
    const pluginsPath = options.pluginsPath || pluginsCommand.opts().pluginsPath
    execSync(`rm -rf ${path.join(process.cwd(), pluginsPath, name)}`)
  })

pluginsCommand
  .command('generate <name>')
  .description('Generate a minimal plugin')
  .action((name, options) => {
    const pluginsPath = options.pluginsPath || pluginsCommand.opts().pluginsPath
    try {
      if (!fs.existsSync(path.join(process.cwd(), pluginsPath))) {
        fs.mkdirSync(path.join(process.cwd(), pluginsPath), { recursive: true })
      }

      const pluginPath = path.join(process.cwd(), pluginsPath, name)
      if (fs.existsSync(pluginPath)) {
        console.error(`Plugin ${name} already exists at ${pluginPath}`)
        process.exit(1)
      }
      
      fs.mkdirSync(pluginPath, { recursive: true })

      const indexContent = `
/**
 * ${name} - Gemini Dock Plugin
 */

module.exports = (options) => {
  const { logger } = options
  logger.debug('${name} loading')

  return {
    name: '${name}',
    success: true,
    on: {
      request: [
        (event) => {
          console.log(event.data)
          return {
            modifiedRequest: event.data.request
          }
        }
      ],

      response: [
        (event) => {
          console.log(event.data)
          return {
            modifiedResponse: event.data.response
          }
        }
      ]
    }
  }
}
`

      fs.writeFileSync(path.join(pluginPath, 'index.js'), indexContent)
      console.log(`Generated plugin ${name} at ${pluginPath}`)
    } catch (error) {
      console.error(`Error generating plugin: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

// Site commands
const sitesCommand = program
  .command('site')
  .description('Manage sites')
  .option('--sites-path <path>', 'path to sites directory', process.env.SITES_PATH || 'sites')

sitesCommand
  .action(() => {
    console.log('Usage: gemini-dock sites [command]')
    console.log('')
    console.log('Commands:')
    console.log('  list                    List all available sites')
    console.log('  generate <name>         Generate a boilerplate site')
    console.log('  install <name> <domain> Install a site')
    console.log('  uninstall <name>        Uninstall a site')
    console.log('')
    console.log('Options:')
    console.log('  --sites-path <path>     Path to sites directory')
    console.log('')
    console.log('Run `gemini-dock sites <command> --help` for more information on a command.')
  })

sitesCommand
  .command('list')
  .description('List all available sites')
  .action((options) => {
    const sitesPath = options.sitesPath || sitesCommand.opts().sitesPath
    try {
      if (!fs.existsSync(path.join(process.cwd(), sitesPath))) {
        console.log(`Sites path ${sitesPath} does not exist`)
        return
      }

      const sites = fs.readdirSync(path.join(process.cwd(), sitesPath))
      console.log(`Available sites in ${sitesPath}:`)
      
      if (sites.length === 0) {
        console.log('No sites found')
        return
      }
      
      sites.forEach(site => { console.log(`- ${site}`) })
    } catch (error) {
      console.error(`Error listing sites: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

sitesCommand
  .command('generate <name>')
  .description('Generate a minimal site')
  .action((name, options) => {
    const sitesPath = options.sitesPath || sitesCommand.opts().sitesPath
    try {
      if (!fs.existsSync(path.join(process.cwd(), sitesPath))) {
        fs.mkdirSync(path.join(process.cwd(), sitesPath), { recursive: true })
      }

      const sitePath = path.join(process.cwd(), sitesPath, name)
      if (fs.existsSync(sitePath)) {
        console.error(`Site already exists at ${sitePath}`)
        process.exit(1)
      }
      
      fs.mkdirSync(sitePath, { recursive: true })

      const indexContent = `/**
 * ${name} - Gemini Dock Site
 */

module.exports = {
  '/': async (event) => ({
    code: 20,
    type: 'text/gemini',
    body: 'Hello world!'
  })
}
`
      fs.writeFileSync(path.join(sitePath, 'index.js'), indexContent)
      console.log(`Generated boilerplate site ${name} at ${sitePath}`)
    } catch (error) {
      console.error(`Error generating site: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

sitesCommand
  .command('install <name> <domain>')
  .description('Install a site')
  .action((name, domain, options) => {
    console.log(`Installing site ${name}...`)
    const sitesPath = options.sitesPath || sitesCommand.opts().sitesPath
    if (!fs.existsSync(path.join(process.cwd(), sitesPath))) {
      fs.mkdirSync(path.join(process.cwd(), sitesPath), { recursive: true })
    }

    const sitePath = path.join(process.cwd(), sitesPath, domain)
    if (fs.existsSync(sitePath)) {
      console.error(`Site ${name} already exists at ${sitePath}`)
      process.exit(1)
    }

    const tmpPath = path.join(os.tmpdir(), 'gemini-dock-npm-install-${name}')
    execSync(`npm install ${name} -g --prefix ${tmpPath}`)
    execSync(`cp -r ${tmpPath}/lib/node_modules/${name} ${sitePath}`)
    execSync(`rm -rf ${tmpPath}`)
  })

sitesCommand
  .command('uninstall <name>')
  .description('Uninstall a site')
  .action((name, options) => {
    console.log(`Uninstalling site ${name}...`)
    const sitesPath = options.sitesPath || sitesCommand.opts().sitesPath
    execSync(`rm -rf ${path.join(process.cwd(), sitesPath, name)}`)
  })

program.parse()
export function startServer(options: {
  name: string
  port: number
  host: string
  backlog: number
  pluginsPath: string
  sitesPath: string
  dbFile: string
}) {
  let dbFile = options.dbFile !== defaultDbFile ? options.dbFile : defaultDbFile
  const dbFileName = dbFile.split('file:')[1]
  logger.info(`Using database file: ${path.join(process.cwd(), dbFileName)}`)

  const newDb = !fs.existsSync(dbFileName)
  const serverDb = drizzle(dbFile, { schema })

  if (newDb) {
    logger.warn('New database detected, you should run `gemini-dock migrate` to initialize the database schema')
    process.exit(1)
  }

  const SERVER_NAME = options.name
  const PORT = options.port
  const HOST = options.host
  const BACKLOG = options.backlog
  const PLUGINS_PATH = options.pluginsPath
  const SITES_PATH = options.sitesPath

  const STARTUP_MODULES = [boot]
  const PLUGIN_LISTENERS: Record<PluginOnKey, PluginListener[]> = { request: [], response: [] }

  if (PLUGINS_PATH && fs.existsSync(path.join(process.cwd(), PLUGINS_PATH))) {
    const plugins = fs.readdirSync(path.join(process.cwd(), PLUGINS_PATH))
    for (const pluginPath of plugins) {
      try {
        const pluginPackage =
          fs.existsSync(path.join(process.cwd(), PLUGINS_PATH, pluginPath, 'package.json'))
            ? JSON.parse(fs.readFileSync(path.join(process.cwd(), PLUGINS_PATH, pluginPath, 'package.json'), 'utf8'))
            : { name: pluginPath }

        const plugin = pluginPackage.name || pluginPath

        let main
        if (!main) main = pluginPackage.exports?.['.']
        if (!main) main = pluginPackage.main
        if (!main) main = pluginPackage.module
        if (!main) main = 'index.js'

        const pluginMainPath = path.join(process.cwd(), PLUGINS_PATH, pluginPath, main)
        if (!fs.existsSync(pluginMainPath)) { logger.error(`${pluginPath} is not a valid plugin`); continue }

        import(pluginMainPath)
          .then(pluginModule => {
            // depending on our environment, we need to use a different default
            if (typeof pluginModule.default?.default === 'function') {
              return pluginModule.default.default({ logger: logger.child({ plugin }) })
            } else {
              return pluginModule.default({ logger: logger.child({ plugin }) })
            }
          })
          .then((pluginReturn: PluginReturnObject) => {
            if (pluginReturn?.success) {
              if (pluginReturn.on.request) PLUGIN_LISTENERS.request.push(...pluginReturn.on.request)
              if (pluginReturn.on.response) PLUGIN_LISTENERS.response.push(...pluginReturn.on.response)
              logger.info(`Loaded: ${pluginReturn.name || plugin} ${pluginReturn.message ? `: ${pluginReturn.message}` : ''}`)
            } else {
              logger.error(`Error loading plugin: ${pluginPath}`)
              logger.error(pluginReturn?.message || 'Unknown error')
            }
          })
          .catch(error => {
            logger.error(`Error loading plugin: ${pluginPath}`)
            logger.error(error.message || 'Unknown error')
          })
      } catch (error) {
        logger.error(`Error loading plugin: ${pluginPath}`)
        logger.error(error.message || 'Unknown error')
      }
    }
  }

  const SERVER = createServer({
    db: serverDb,
    listeners: { request: PLUGIN_LISTENERS.request, response: PLUGIN_LISTENERS.response },
    sitesPath: SITES_PATH
  })

  if (!SERVER) {
    logger.error('Failed to create server. Check certificate errors above.')
    logger.error('If you need to generate certificates, use: gemini-dock certificate generate localhost')
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
  
  // Return database instance
  return serverDb
}
