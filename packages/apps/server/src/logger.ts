import pino from 'pino'

const logger = process.env.ENVIRONMENT === 'development'
  ? pino({
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true
        }
      }
    })
  : pino({ level: 'debug' })

export default logger