import fs from 'fs'
import path from 'path'
import tls from 'tls'

import logger from './logger'
import type { PluginListener, SiteOptions, SiteRoute } from '@gemini-dock/types'

const SITES_PATH = process.env.SITES_PATH || 'sites'
const SERVER_CERTS: Record<string, { key: Buffer, cert: Buffer }> = {}

for (const site of fs.readdirSync(path.join('.certs'))) {
  const certData = {
    key: fs.readFileSync(path.join('.certs', site, 'private.key')),
    cert: fs.readFileSync(path.join('.certs', site, 'certificate.pem'))
  }

  SERVER_CERTS[site] = certData
}

export default (requestListeners: PluginListener[] = [], responseListeners: PluginListener[] = []) => {
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
    // @ts-ignore
    const servername = socket.servername || 'unknown'
    // logger.info(`${socket.remoteAddress}:${socket.remotePort} connected securely to ${servername}`)
    
    let requestData = Buffer.alloc(0)
    
    socket.on('data', async (data) => {
      requestData = Buffer.concat([requestData, data])
      
      // Process request if we have a complete Gemini request
      // Gemini requests end with CR LF
      if (requestData.includes(Buffer.from('\r\n'))) {
        const request = requestData.toString('utf8').trim()
        logger.info(socket.remoteAddress + ':' + socket.remotePort + ' - ' + request)
        
        // URI length check
        if (request.length > 1024) {
          logger.error('Request is too long')
          socket.write(Buffer.from('59 Bad Request: URI is too long\r\n'))
          socket.destroy()
          return
        }
        
        let url: URL
        try {
          // Verify URI format
          url = new URL(request)
          
          // Check for userinfo portion (username/password)
          if (url.username || url.password) {
            logger.error('URI contains userinfo portion')
            socket.write(Buffer.from('59 Bad Request: userinfo not allowed in URI\r\n'))
            socket.destroy()
            return
          }
          
          // Check for fragments
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
        
        for (const listener of requestListeners) {
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
          // Reset request buffer and continue listening
          requestData = Buffer.alloc(0)
          return
        }

        // Process site
        try {
          const site = await import(path.join(process.cwd(), SITES_PATH, servername))
          const root = '/' + url.pathname.split('/')[1]
          const certificate = socket.getPeerCertificate()
          const siteResponse = (site.routes[root] as SiteRoute)({
            url,
            certificate,
            input: Array.from(url.searchParams.entries())?.[0]?.[0],
            logger: logger.child({ site: servername }),
          } as SiteOptions)

          if (siteResponse.body) modifiedResponse.body = siteResponse.body
          if (siteResponse.code) modifiedResponse.code = siteResponse.code
          if (siteResponse.type) modifiedResponse.type = siteResponse.type
        } catch (error) {
          logger.error('Error in site: ' + servername)
          logger.error(error)
        }
        
        // Notify response listeners
        for (const listener of responseListeners) {
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
            
            // Allow listeners to modify the response
            if (result && result.modifiedResponse) {
              logger.debug(`Response being modified by listener from plugin`)
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
        
        // Reset request buffer
        requestData = Buffer.alloc(0)
        
        // After sending the complete response, close the connection
        // using TLS close_notify as required by the Gemini protocol
        logger.info(`${socket.remoteAddress}:${socket.remotePort} - ${modifiedResponse.code} ${modifiedResponse.code !== 20 ? modifiedResponse.type : modifiedResponse.body.length}`)
        socket.write(Buffer.from(`${modifiedResponse.code} ${modifiedResponse.type}\r\n${modifiedResponse.body.split('\n').map(line => line.trim()).join('\r\n')}\r\n`))
        socket.end()
      }
    })

    socket.on('error', (error) => {
      logger.error('Socket error', error)
      socket.destroy()
    })

    // socket.on('end', () => {
      // logger.info('Connection ended')
    // })

    // socket.on('close', () => {
    //   logger.info('Connection closed')
    // })
  })

  server.on('error', (error) => {
    logger.error('Server error', error)
  })

  return server
}