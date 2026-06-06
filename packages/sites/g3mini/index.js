/**
 * g3mini - Gemini Dock Site
 */

module.exports = {
  '/': async (event) => ({
    code: 20,
    type: 'text/gemini',
    body: 'Hello world!'
  })
}
