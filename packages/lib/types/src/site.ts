import * as schema from '@gemini-dock/schema'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { Logger } from 'pino'
import type { PeerCertificate } from 'tls'

export interface SiteOptions {
  servername: string
  db: LibSQLDatabase<typeof schema>
  url: URL
  certificate: PeerCertificate
  input?: string
  logger: Logger
}

export interface SiteRoute {
  (options: SiteOptions): Promise<SiteResponse>
}

export interface SiteResponse {
  code: number
  type: string
  body: string
}
