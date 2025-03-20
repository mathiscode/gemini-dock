import pino from 'pino'

export default pino({
  level: 'debug',
  transport: {
    target: process.env.ENVIRONMENT === 'development' ? 'pino-pretty' : 'console',
    options: {
      colorize: true
    }
  }
})