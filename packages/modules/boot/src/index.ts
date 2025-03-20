import { ModuleOptions } from '@gemini-dock/types'

export default function boot(options: ModuleOptions) {
  const { logger } = options
  logger.info('Booting...')
}
