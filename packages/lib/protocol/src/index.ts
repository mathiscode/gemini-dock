export const CODES = {
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
    case CODES.CERTIFICATE_REQUIRED:
      return { code, type: 'Certificate required for this route' }
    case CODES.CERTIFICATE_NOT_AUTHORIZED:
      return { code, type: 'Certificate not authorized for this route' }
    case CODES.CERTIFICATE_INVALID:
      return { code, type: 'Certificate invalid for this route' }
    case CODES.FAIL_BAD_REQUEST:
    case CODES.FAIL_CGI_ERROR:
    case CODES.FAIL_GONE:
    case CODES.FAIL_NOT_FOUND:
    case CODES.FAIL_PERMANENT:
    case CODES.FAIL_PROXY_ERROR:
    case CODES.FAIL_PROXY_REQUEST_ERROR:
    case CODES.FAIL_SERVER_UNAVAILABLE:
    case CODES.FAIL_SLOW_DOWN:
    case CODES.FAIL_TEMPORARY:
    case CODES.REDIRECT_PERMANENT:
    case CODES.REDIRECT_TEMPORARY:
      return { code, type: body }
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
