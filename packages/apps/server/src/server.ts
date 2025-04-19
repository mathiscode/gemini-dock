import fs from 'fs'
import path from 'path'
import tls from 'tls'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import * as schema from '@gemini-dock/schema'
import logger from './logger'
import type { PluginListener, SiteOptions, SiteRoute } from '@gemini-dock/types'

const SITES_PATH = process.env.SITES_PATH || 'sites'

// Function to load certificates when needed
const loadCertificates = (certsPath: string = process.env.CERTS_PATH || '.certs') => {
  const certStore: Record<string, { key: Buffer, cert: Buffer }> = {}
  
  if (!fs.existsSync(certsPath)) {
    logger.error(`No certificates found at ${certsPath}, use the CERTS_PATH environment variable to specify a different path`)
    return null
  }
  
  for (const site of fs.readdirSync(certsPath)) {
    const keyPath = path.join(certsPath, site, 'private.key')
    const certPath = path.join(certsPath, site, 'certificate.pem')
    
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      logger.error(`No valid certificates found at ${certsPath}/${site}`)
      continue
    }
    
    try {
      const certData = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      }
      
      certStore[site] = certData
    } catch (error) {
      logger.error(`Error loading certificates for ${site}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  
  if (Object.keys(certStore).length === 0) {
    logger.error('No valid certificates found')
    return null
  }
  
  return certStore
}

export default (options: {
  db: LibSQLDatabase<typeof schema>,
  listeners: { request: PluginListener[], response: PluginListener[] },
  sitesPath: string
}) => {
  const { db, listeners, sitesPath } = options

  // Load certificates when server is being created
  const SERVER_CERTS = loadCertificates()
  
  if (!SERVER_CERTS) {
    logger.error('Failed to load certificates required for server')
    return null
  }

  const defaultCert = SERVER_CERTS['localhost'] || Object.values(SERVER_CERTS)[0]

  if (!defaultCert) {
    logger.error('No certificates found!')
    return null
  }

  const tlsOptions = {
    key: defaultCert.key,
    cert: defaultCert.cert,
    requestCert: true,
    rejectUnauthorized: false,
    SNICallback: (servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) => {
      if (SERVER_CERTS[servername]) {
        const ctx = tls.createSecureContext({
          key: SERVER_CERTS[servername].key,
          cert: SERVER_CERTS[servername].cert
        })
        cb(null, ctx)
      } else {
        // Fall back to default certificate
        const ctx = tls.createSecureContext({
          key: defaultCert.key,
          cert: defaultCert.cert
        })
        cb(null, ctx)
      }
    }
  }

  const server = tls.createServer(tlsOptions, (socket) => {
    // @ts-expect-error
    const servername = socket.servername || 'unknown'
    const clientAddress = socket.remoteAddress
    let requestData = Buffer.alloc(0)
    
    socket.on('data', async (data) => {
      requestData = Buffer.concat([requestData, data])
      
      if (requestData.includes(Buffer.from('\r\n'))) {
        const request = requestData.toString('utf8').trim()
        logger.info(socket.remoteAddress + ':' + socket.remotePort + ' - ' + request.split('?')[0])
        
        // Validate request
        if (request.length > 1024) {
          logger.error('Request is too long')
          socket.write(Buffer.from('59 Bad Request: URI is too long\r\n'))
          socket.destroy()
          return
        }
        
        let url: URL
        try {
          url = new URL(request)
          
          if (url.username || url.password) {
            logger.error('URI contains userinfo portion')
            socket.write(Buffer.from('59 Bad Request: userinfo not allowed in URI\r\n'))
            socket.destroy()
            return
          }
          
          if (url.hash) {
            logger.error('URI contains fragment')
            socket.write(Buffer.from('59 Bad Request: fragments not allowed in URI\r\n'))
            socket.destroy()
            return
          }
        } catch (error) {
          logger.error('Invalid URI format', error)
          socket.write(Buffer.from('59 Bad Request: invalid URI format\r\n'))
          socket.destroy()
          return
        }
        
        // Notify request listeners
        let modifiedRequest = request
        let modifiedResponse = { code: 20, type: 'text/gemini', body: '' }
        let shouldContinue = true
        
        for (const listener of listeners.request) {
          try {
            const result = listener({
              type: 'request',
              data: {
                request: modifiedRequest,
                url,
                socket,
                remoteAddress: socket.remoteAddress,
                remotePort: socket.remotePort
              }
            })
            
            // Allow listeners to modify the request or stop processing
            if (result) {
              if (result.modifiedRequest) modifiedRequest = result.modifiedRequest
              if (result.modifiedResponse) {
                if (result.modifiedResponse.code) modifiedResponse.code = result.modifiedResponse.code
                if (result.modifiedResponse.type) modifiedResponse.type = result.modifiedResponse.type
                if (result.modifiedResponse.body) modifiedResponse.body = result.modifiedResponse.body
              }

              if (result.hasOwnProperty('continueProcessing') && result.continueProcessing === false) {
                shouldContinue = false
                break
              }
            }
          } catch (error) {
            logger.error('Error in request listener', error)
          }
        }
        
        // Skip response handling if a listener has indicated to stop
        if (!shouldContinue) {
          logger.info(socket.remoteAddress + ':' + socket.remotePort + ' - Request listener indicated to stop processing the request')
          requestData = Buffer.alloc(0)
          socket.destroy()
          return
        }

        // Process site
        try {
          const sitePackage = fs.existsSync(path.join(process.cwd(), SITES_PATH, servername, 'package.json'))
            ? JSON.parse(fs.readFileSync(path.join(process.cwd(), SITES_PATH, servername, 'package.json'), 'utf8'))
            : null

          let main
          if (!main) main = sitePackage?.exports?.['.']
          if (!main) main = sitePackage?.main
          if (!main) main = sitePackage?.module
          if (!main) main = 'index.js'

          const sitePath = path.join(process.cwd(), SITES_PATH, servername, main)
          if (!fs.existsSync(sitePath)) {
            logger.error('Site not found: ' + servername)
            socket.write(Buffer.from('51 Site not found\r\n'))
            socket.destroy()
            return
          }

          const siteModule = await import(sitePath)
          const site = siteModule.default || siteModule
          const root = '/' + url.pathname.split('/')[1]
          const certificate = socket.getPeerCertificate()

          const route = (site.default?.default || site.default || site)[root] as SiteRoute // yo dawg 🎳
          if (!route) {
            logger.error('No route found for ' + root)
            socket.write(Buffer.from('51 Route not found\r\n'))
            socket.destroy()
            return
          }

          const siteResponse = await route({
            db,
            url,
            certificate,
            servername,
            clientAddress,
            input: Array.from(url.searchParams.entries())?.[0]?.[0],
            logger: logger.child({ site: servername }),
          } as SiteOptions)

          if (siteResponse.body) modifiedResponse.body = siteResponse.body
          if (siteResponse.code) modifiedResponse.code = siteResponse.code
          if (siteResponse.type) modifiedResponse.type = siteResponse.type
        } catch (error) {
          logger.error('Error in site: ' + servername)
          logger.error(error)
          socket.write(Buffer.from('42 Site error\r\n'))
          socket.destroy()
          return
        }
        
        // Notify response listeners
        for (const listener of listeners.response) {
          try {
            const result = listener({
              type: 'response',
              data: {
                request: modifiedRequest,
                response: modifiedResponse.body,
                socket,
                remoteAddress: socket.remoteAddress,
                remotePort: socket.remotePort
              }
            })
            
            if (result && result.modifiedResponse) {
              if (result.modifiedResponse.code !== undefined) {
                modifiedResponse.code = result.modifiedResponse.code
              }
              if (result.modifiedResponse.type !== undefined) {
                modifiedResponse.type = result.modifiedResponse.type
              }
              if (result.modifiedResponse.body !== undefined) {
                modifiedResponse.body = result.modifiedResponse.body
              }
            }
          } catch (error) {
            logger.error('Error in response listener', error)
          }
        }
        
        try {
          requestData = Buffer.alloc(0)
          logger.info(`${socket.remoteAddress}:${socket.remotePort} - ${modifiedResponse.code} Content-Length: ${modifiedResponse.code !== 20 ? modifiedResponse.type : modifiedResponse.body.length}`)
          if (Buffer.isBuffer(modifiedResponse.body)) {
            socket.write(Buffer.from(`${modifiedResponse.code} ${modifiedResponse.type}\r\n`))
            socket.write(modifiedResponse.body)
            socket.write(Buffer.from('\r\n'))
          } else {
            socket.write(Buffer.from(`${modifiedResponse.code} ${modifiedResponse.type}\r\n${modifiedResponse.body?.split?.('\n').map(line => line.trim()).join('\r\n')}\r\n`))
          }
        } catch (error) {
          logger.error('Error in response', error)
          socket.write(Buffer.from('42 Site error\r\n'))
        } finally {
          socket.end()
        }
      }
    })

    socket.on('error', (error) => {
      logger.error('Socket error', error)
      socket.destroy()
    })
  })

  server.on('error', (error) => {
    logger.error('Server error', error)
  })

  return server
}