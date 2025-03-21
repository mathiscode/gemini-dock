import type { PluginOptions, PluginReturnObject } from '@gemini-dock/types'

export default function plugin(_: PluginOptions): PluginReturnObject {
  // const { logger } = options

  return {
    success: true,
    on: {
      request: [
        () => {
          // logger.info('Request received', event.data.request)
        }
      ],
      response: [
        (event) => {
          // return {
          //   modifiedResponse: {
          //     code: 20,
          //     body: 'I am a cool content plugin!'
          //   },
          // }
        }
      ]
    }
  }
}
