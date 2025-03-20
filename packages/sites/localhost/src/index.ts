import type { SiteOptions } from '@gemini-dock/types'

export const routes = {
  '/': () => {
    return {
      code: 20,
      type: 'text/gemini',
      body: `
        # Gemini Dock

        This is a test site for Gemini Dock.
        It is currently ${new Date().toLocaleString()} on the server.

        => /login Login

        => https://gem.mathis.network
      `,
    }
  },

  '/login': (options: SiteOptions) => {
    const { certificate } = options

    if (!certificate?.subject) return {
      code: 60,
      type: 'Certificate required for this route'
    }

    return {
      code: 20,
      type: 'text/gemini',
      body: `
        # Login

        Welcome ${certificate.subject.CN}

        \`\`\`
        ${JSON.stringify(certificate.subject, null, 2)}
        \`\`\`

        => /logout Logout
      `
    }
  },

  '/logout': () => {
    // TODO: Logout the user
    return {
      code: 31,
      type: '/'
    }
  }
}

export default routes
