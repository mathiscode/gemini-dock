import pino from 'pino'

export type PluginOnKey = 'request' | 'response'

export interface Plugin {
  name: string
  description: string
  version: string
  initialize: ({ _options }: { _options: PluginOptions }) => Promise<PluginReturnObject>
}

export interface PluginOptions {
  logger: pino.Logger
}

export interface PluginEvent {
  type: PluginOnKey
  data: unknown
}

export interface PluginListener {
  (_event: PluginEvent): void
}

export interface PluginReturnObject {
  success: boolean
  message?: string
  on: {
    // TODO: find out why this is saying unused for key
    [key in PluginOnKey]?: PluginListener[] // eslint-disable-line
  }
}
