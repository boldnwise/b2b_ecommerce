import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import { api, resetCsrfState } from '../services/api.js'

function headerValue(headers, name) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') {
    const fromGetter = headers.get(name)
    if (fromGetter) return fromGetter
  }
  return headers[name] || headers[name.toLowerCase()]
}

function jsonResponse(config, headers, status = 200) {
  return {
    data: { success: true, data: { user: { id: 'user-1' } } },
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    config,
  }
}

describe('in-memory CSRF token', () => {
  let calls

  beforeEach(() => {
    resetCsrfState()
    calls = []
    document.cookie = 'csrf_token=from-document'
    api.defaults.adapter = async (config) => {
      calls.push(config)
      return jsonResponse(config, {})
    }
  })

  it('captures the login header and sends it on the next mutation', async () => {
    api.defaults.adapter = async (config) => {
      calls.push(config)
      const headers = String(config.url).includes('/auth/login')
        ? { 'x-csrf-token': 'issued-login' }
        : {}
      return jsonResponse(config, headers)
    }

    await api.post('/auth/login', { email: 'a@example.com', password: 'secret' })
    await api.post('/products', { name: 'Widget' })

    expect(headerValue(calls[1].headers, 'X-CSRF-Token')).toBe('issued-login')
    expect(headerValue(calls[1].headers, 'X-CSRF-Token')).not.toBe('from-document')
  })

  it('replaces the stored token when /auth/me returns a fresh token', async () => {
    api.defaults.adapter = async (config) => {
      calls.push(config)
      const url = String(config.url)
      const headers = url.includes('/auth/login')
        ? { 'x-csrf-token': 'issued-login' }
        : url.includes('/auth/me')
          ? { 'x-csrf-token': 'issued-me' }
          : {}
      return jsonResponse(config, headers)
    }

    await api.post('/auth/login', { email: 'a@example.com', password: 'secret' })
    await api.get('/auth/me')
    await api.patch('/products/1', { name: 'Updated' })

    expect(headerValue(calls[2].headers, 'X-CSRF-Token')).toBe('issued-me')
  })

  it('holds mutations until the in-flight /auth/me token is stored', async () => {
    let releaseMe
    api.defaults.adapter = async (config) => {
      const url = String(config.url)
      if (url.includes('/auth/me')) {
        return new Promise((resolve) => {
          releaseMe = () => resolve(jsonResponse(config, { 'x-csrf-token': 'fresh-me' }))
        })
      }
      calls.push(config)
      return jsonResponse(config, {})
    }

    const mePromise = api.get('/auth/me')
    let posted = false
    const postPromise = api.post('/products', { name: 'Widget' }).then((response) => {
      posted = true
      return response
    })

    await vi.waitFor(() => {
      expect(typeof releaseMe).toBe('function')
    })
    expect(posted).toBe(false)
    expect(calls).toHaveLength(0)

    releaseMe()
    await mePromise
    await postPromise

    expect(calls).toHaveLength(1)
    expect(headerValue(calls[0].headers, 'X-CSRF-Token')).toBe('fresh-me')
  })

  it('does not attach a CSRF header to GET requests or to mutations before a token exists', async () => {
    await api.get('/products')
    await api.delete('/products/1')

    expect(headerValue(calls[0].headers, 'X-CSRF-Token')).toBeUndefined()
    expect(headerValue(calls[1].headers, 'X-CSRF-Token')).toBeUndefined()
  })
})

function failedResponse(config, status, code) {
  return Promise.reject(new AxiosError(
    'request failed',
    'ERR_BAD_REQUEST',
    config,
    null,
    {
      status,
      statusText: status === 403 ? 'Forbidden' : 'Unauthorized',
      headers: {},
      config,
      data: {
        success: false,
        error: { code, message: code },
      },
    },
  ))
}

describe('CSRF resync without retrying the mutation', () => {
  beforeEach(() => {
    resetCsrfState()
    vi.spyOn(Storage.prototype, 'setItem')
  })

  it('shares one /auth/me resync across simultaneous 403 responses and does not replay the mutation', async () => {
    const calls = []
    let releaseMe
    api.defaults.adapter = async (config) => {
      const url = String(config.url)
      if (url.includes('/auth/me')) {
        calls.push(url)
        return new Promise((resolve) => {
          releaseMe = () => resolve(jsonResponse(config, { 'x-csrf-token': 'resynced-token' }))
        })
      }
      calls.push(url)
      return failedResponse(config, 403, 'CSRF_VALIDATION_FAILED')
    }

    const first = api.post('/products', { name: 'One' })
    const second = api.post('/products', { name: 'Two' })

    await vi.waitFor(() => {
      expect(calls.filter((url) => url.includes('/products'))).toHaveLength(2)
      expect(calls.filter((url) => url.includes('/auth/me'))).toHaveLength(1)
    })
    expect(calls.filter((url) => url.includes('/auth/me'))).toHaveLength(1)

    releaseMe()
    await expect(first).rejects.toMatchObject({
      response: { data: { error: { code: 'CSRF_VALIDATION_FAILED' } } },
    })
    await expect(second).rejects.toMatchObject({
      response: { data: { error: { code: 'CSRF_VALIDATION_FAILED' } } },
    })
    expect(calls.filter((url) => url.includes('/products'))).toHaveLength(2)

    calls.length = 0
    api.defaults.adapter = async (config) => {
      calls.push(config)
      return jsonResponse(config, {})
    }
    await api.post('/products', { name: 'Retry by caller' })
    expect(headerValue(calls[0].headers, 'X-CSRF-Token')).toBe('resynced-token')
    expect(Storage.prototype.setItem).not.toHaveBeenCalled()
  })

  it('clears the in-memory token when resync fails and does not replay the mutation', async () => {
    const calls = []
    api.defaults.adapter = async (config) => {
      const url = String(config.url)
      calls.push(url)
      if (url.includes('/auth/login')) {
        return jsonResponse(config, { 'x-csrf-token': 'issued-login' })
      }
      if (url.includes('/auth/me')) {
        return failedResponse(config, 401, 'UNAUTHORIZED')
      }
      return failedResponse(config, 403, 'CSRF_VALIDATION_FAILED')
    }

    await api.post('/auth/login', { email: 'a@example.com', password: 'secret' })
    await expect(api.post('/products', { name: 'Widget' })).rejects.toMatchObject({
      response: { status: 403 },
    })
    expect(calls.filter((url) => url.includes('/products'))).toHaveLength(1)
    expect(calls.filter((url) => url.includes('/auth/me'))).toHaveLength(1)

    calls.length = 0
    api.defaults.adapter = async (config) => {
      calls.push(config)
      return jsonResponse(config, {})
    }
    await api.delete('/products/1')
    expect(headerValue(calls[0].headers, 'X-CSRF-Token')).toBeUndefined()
    expect(Storage.prototype.setItem).not.toHaveBeenCalled()
  })

  it('does not restore the token when logout completes during an in-flight CSRF resync', async () => {
    const calls = []
    let releaseLogout
    let releaseMe
    api.defaults.adapter = async (config) => {
      const url = String(config.url)
      if (url.includes('/auth/logout')) {
        calls.push(url)
        return new Promise((resolve) => {
          releaseLogout = () => resolve(jsonResponse(config, {}))
        })
      }
      if (url.includes('/auth/me')) {
        calls.push(url)
        return new Promise((resolve) => {
          releaseMe = () => resolve(jsonResponse(config, { 'x-csrf-token': 'late-me' }))
        })
      }
      calls.push(url)
      return failedResponse(config, 403, 'CSRF_VALIDATION_FAILED')
    }

    const logout = api.post('/auth/logout')
    await vi.waitFor(() => {
      expect(typeof releaseLogout).toBe('function')
    })

    const mutation = api.post('/products', { name: 'Widget' })
    await vi.waitFor(() => {
      expect(calls.filter((url) => url.includes('/auth/me'))).toHaveLength(1)
    })

    releaseLogout()
    await logout
    releaseMe()
    await expect(mutation).rejects.toMatchObject({
      response: { data: { error: { code: 'CSRF_VALIDATION_FAILED' } } },
    })
    expect(calls.filter((url) => url.includes('/products'))).toHaveLength(1)
    expect(calls.filter((url) => url.includes('/auth/me'))).toHaveLength(1)

    calls.length = 0
    api.defaults.adapter = async (config) => {
      calls.push(config)
      return jsonResponse(config, {})
    }
    await api.post('/products', { name: 'After logout' })
    expect(headerValue(calls[0].headers, 'X-CSRF-Token')).toBeUndefined()
  })
})
