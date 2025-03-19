import Pino from 'pino'

export default function boot(options: BootOptions) {
  const { logger } = options
  logger.info('Booting...')
}

export interface BootOptions {
  logger: Pino.Logger
}
