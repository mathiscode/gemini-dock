const CODES = {
  REQUEST_INPUT: 10,
  REQUEST_PASSWORD: 11,
  SUCCESS: 20,
  REDIRECT_TEMPORARY: 30,
  REDIRECT_PERMANENT: 31,
  FAIL_TEMPORARY: 40,
  FAIL_SERVER_UNAVAILABLE: 41,
  FAIL_CGI_ERROR: 42,
  FAIL_PROXY_ERROR: 43,
  FAIL_SLOW_DOWN: 44,
  FAIL_PERMANENT: 50,
  FAIL_NOT_FOUND: 51,
  FAIL_GONE: 52,
  FAIL_PROXY_REQUEST_ERROR: 53,
  FAIL_BAD_REQUEST: 59,
  CERTIFICATE_REQUIRED: 60,
  CERTIFICATE_NOT_AUTHORIZED: 61,
  CERTIFICATE_INVALID: 62
}

export const respond = (code: number, body?: string, type: string = 'text/gemini') => {
  switch (code) {
    case CODES.REQUEST_INPUT:
      return { code, type: body || 'Please provide input' }
    case CODES.REQUEST_PASSWORD:
      return { code, type: body || 'Please provide password' }
    case CODES.SUCCESS:
      return { code, type, body }
    default:
      return { code, type: 'An error occurred' }
  }
}