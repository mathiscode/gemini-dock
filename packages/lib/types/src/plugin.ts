import type { Logger } from 'pino'

export type PluginOnKey = 'request' | 'response'

export interface Plugin {
  name: string
  description: string
  version: string
  initialize: ({ _options }: { _options: PluginOptions }) => Promise<PluginReturnObject>
}

export interface PluginOptions {
  logger: Logger
}

export interface PluginEvent {
  type: PluginOnKey
  data: PluginRequestData | PluginResponseData
}

export interface PluginRequestData {
  request: string
  socket: any
  remoteAddress: string | undefined
  remotePort: number | undefined
  url: URL
}

export interface PluginResponseData {
  request: string
  response: string
  socket: any
  remoteAddress: string | undefined
  remotePort: number | undefined
}

export interface PluginListenerResult {
  modifiedRequest?: string
  continueProcessing?: boolean
  modifiedResponse?: {
    code?: number
    type?: string
    body?: string
  }
}

export interface PluginListener {
  (_event: PluginEvent): PluginListenerResult | void
}

export interface PluginReturnObject {
  name?: string
  success: boolean
  message?: string
  on: {
    // TODO: find out why this is saying unused for key
    [key in PluginOnKey]?: PluginListener[] // eslint-disable-line
  }
}
