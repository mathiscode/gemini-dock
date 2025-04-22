import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources'

import { data, drizzle } from '@gemini-dock/schema'
import { CODES, respond } from '@gemini-dock/protocol'
import { SiteOptions } from '@gemini-dock/types'

const { and, eq, lt, sql } = drizzle

const PUBLIC_KEY = process.env.OPENROUTER_API_KEY
const PUBLIC_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL_ID = process.env.OPENROUTER_MODEL_ID || 'mistralai/mistral-small-3.1-24b-instruct:free'
const CLEANUP_INTERVAL = process.env.GEMINAI_CLEANUP_INTERVAL || '-7 days'
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 10

const rateLimitStore = new Map<string, number[]>()

const systemPrompt = `
  You are a helpful assistant running on the Gemini protocol.
  Gemini is a new internet technology supporting an electronic library of interconnected text documents. That's not a new idea, but it's not old fashioned either. It's timeless, and deserves tools which treat it as a first class concept, not a vestigial corner case. Gemini isn't about innovation or disruption, it's about providing some respite for those who feel the internet has been disrupted enough already. We're not out to change the world or destroy other technologies. We are out to build a lightweight online space where documents are just documents, in the interests of every reader's privacy, attention and bandwidth.

  Don't unnecessarily mention Gemini unless it's relevant to the conversation, and don't make up fake links just to fill out content.
  Respond with the most concise answer possible, and only use the tags below if they are relevant to the conversation or your formatting.

  You should always output in Gemtext format (NOT MARKDOWN OR HTML):

  # Heading 1
  ## Heading 2
  ### Heading 3
  * List Item
  > Quote
  => Web Link
  
  \`\`\`
  Code Block
  \`\`\`

  You do not need to use each of these tags (or any of them), but you should use them if they are appropriate.
  If you are including an http link, make sure to include the protocol (http or https) in the link.
`

const openai = new OpenAI({
  baseURL: PUBLIC_BASE_URL,
  apiKey: PUBLIC_KEY
})

const cleanupOldSessions = async (db: SiteOptions['db']) => {
  try {
    const cleanupInterval = sql`datetime('now', ${CLEANUP_INTERVAL})`
    await db.delete(data).where(lt(data.updatedAt, cleanupInterval))
  } catch (error) {
    console.error('Error cleaning up old sessions:', error)
  }
}

function checkRateLimit(fingerprint: string, clientAddress: string): boolean {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const fpKey = `fp:${fingerprint}`
  const ipKey = `ip:${clientAddress}`
  const fpTimestamps = rateLimitStore.get(fpKey) || []
  const ipTimestamps = rateLimitStore.get(ipKey) || []
  const recentFpTimestamps = fpTimestamps.filter(ts => ts >= windowStart)
  const recentIpTimestamps = ipTimestamps.filter(ts => ts >= windowStart)

  if (recentFpTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    rateLimitStore.set(fpKey, recentFpTimestamps)
    console.warn(`Rate limit exceeded for fingerprint ${fingerprint}`)
    return false
  }

  if (recentIpTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    rateLimitStore.set(ipKey, recentIpTimestamps)
    console.warn(`Rate limit exceeded for IP ${clientAddress}`)
    return false
  }

  recentFpTimestamps.push(now)
  recentIpTimestamps.push(now)
  rateLimitStore.set(fpKey, recentFpTimestamps)
  rateLimitStore.set(ipKey, recentIpTimestamps)

  return true
}

export const routes = {
  '/': async (options: SiteOptions) => {
    const { certificate, db, url, clientAddress } = options
    await cleanupOldSessions(db)
    if (!certificate?.subject || !certificate?.fingerprint256) return respond(CODES.CERTIFICATE_REQUIRED)
    if (!clientAddress) return respond(CODES.FAIL_TEMPORARY, 'Client address not available')
    if (!checkRateLimit(certificate.fingerprint256, clientAddress)) return respond(CODES.FAIL_SLOW_DOWN, 'Rate limit exceeded. Please try again later.')

    const sessionId = crypto.randomUUID()

    await db.insert(data).values({
      name: sessionId,
      site: url.hostname,
      value: JSON.stringify({
        started: Date.now(),
        client: certificate.fingerprint256,
        ipAddress: clientAddress,
        messages: []
      }),
      updatedAt: getSQLiteTimestamp()
    })

    return respond(CODES.REDIRECT_TEMPORARY, `/chat/${sessionId}`)
  },

  '/chat': async (options: SiteOptions) => {
    const { certificate, db, url, clientAddress } = options
    if (!certificate?.subject || !certificate?.fingerprint256) return respond(CODES.CERTIFICATE_REQUIRED)
    if (!clientAddress) return respond(CODES.FAIL_TEMPORARY, 'Client address not available')
    if (!checkRateLimit(certificate.fingerprint256, clientAddress)) return respond(CODES.FAIL_SLOW_DOWN, 'Rate limit exceeded. Please try again later.')

    const sessionId = url.pathname.split('/').pop()
    if (!sessionId) return respond(CODES.FAIL_TEMPORARY, 'Session ID is required')

    const result = await db.query.data.findFirst({ where: and(eq(data.name, sessionId), eq(data.site, url.hostname)) })
    if (!result) return respond(CODES.FAIL_PERMANENT, 'Session not found')
    const session = JSON.parse(result?.value || '{}')
    const messages = session.messages || []

    const separator = '# -------------------------------'

    const output = `
      # 🗪 GeminAI Chat
      Session: ${sessionId}
      => gemini://gem.mathis.network Made with ❤️ by Jay Mathis
      

      => / New Session
      => /send/${sessionId} Send Message

      ${separator}

      ${messages.length ? messages.slice().reverse().map((message: ChatCompletionMessageParam) =>
        `${message.role === 'user' ? '### --- USER ---' : '### --- ASSISTANT ---'}
        ${message.role === 'user' ? '> ' : ''}${message.content}`
      ).join('\n') : '## No messages yet'}

      ${separator}

      => / New Session
      => /send/${sessionId} Send Message
    `

    return respond(CODES.SUCCESS, output)
  },

  '/send': async (options: SiteOptions) => {
    const { certificate, db, input, url, clientAddress } = options
    if (!certificate?.subject || !certificate?.fingerprint256) return respond(CODES.CERTIFICATE_REQUIRED)
    if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter a message to send')
    if (!clientAddress) return respond(CODES.FAIL_TEMPORARY, 'Client address not available')
    if (!checkRateLimit(certificate.fingerprint256, clientAddress)) return respond(CODES.FAIL_SLOW_DOWN, 'Rate limit exceeded. Please try again later.')

    const sessionId = url.pathname.split('/').pop()
    if (!sessionId) return respond(CODES.FAIL_TEMPORARY, 'Session ID is required')
    const result = await db.query.data.findFirst({ where: and(eq(data.name, sessionId), eq(data.site, url.hostname)) })
    if (!result) return respond(CODES.FAIL_PERMANENT, 'Session not found')
    const session = JSON.parse(result?.value || '{}')
    const messages = session.messages || []

    let response
    try {
      response = await openai.chat.completions.create({
        model: process.env.OPENROUTER_MODEL_ID || DEFAULT_MODEL_ID,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
          { role: 'user', content: input }
        ]
      })
    } catch (error) {
      console.error('Error calling OpenAI API:', error)
      return respond(CODES.FAIL_TEMPORARY, 'Failed to get response from the AI model.')
    }

    if (!response?.choices?.[0]?.message?.content) return respond(CODES.FAIL_TEMPORARY, 'No response from the model')

    await db.update(data).set({
      value: JSON.stringify({
        ...session,
        messages: [
          ...(messages || []),
          { role: 'user', content: input },
          { role: 'assistant', content: response.choices[0].message.content || '' }
        ]
      }),
      updatedAt: getSQLiteTimestamp()
    }).where(and(eq(data.name, sessionId), eq(data.site, url.hostname)))

    return respond(CODES.REDIRECT_TEMPORARY, `/chat/${sessionId}`)
  }
}

function getSQLiteTimestamp(date = new Date()): string {
  const pad = (num: number) => num.toString().padStart(2, '0')

  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}


export default routes
