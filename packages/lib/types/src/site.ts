import type { Logger } from 'pino'
import type { PeerCertificate } from 'tls'

export interface SiteOptions {
  url: URL
  certificate: PeerCertificate
  input?: string
  logger: Logger
}

export interface SiteRoute {
  (options: SiteOptions): SiteResponse
}

export interface SiteResponse {
  code: number
  type: string
  body: string
}
