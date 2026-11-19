import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import * as authApi from '../../services/auth.service.js'

/**
 * On app start, hit GET /auth/me. The browser automatically sends the
 * httpOnly cookie — if valid the server returns the user; if not, 401.
 */
export const initializeAuth = createAsyncThunk('auth/initialize', async (_, { rejectWithValue }) => {
  try {
    const user = await authApi.fetchMeRequest()
    return user ?? null
  } catch {
    return rejectWithValue(null)
  }
})

export const login = createAsyncThunk(
  'auth/login',
  async ({ email, password }, { rejectWithValue }) => {
    try {
      const { user } = await authApi.loginRequest({ email, password })
      return user
    } catch (e) {
      return rejectWithValue(e.message || 'Login failed')
    }
  },
)

/**
 * Ask the server to clear the auth cookie then wipe local Redux state.
 * The cookie clear is best-effort — Redux state is always cleared regardless.
 */
export const logoutUser = createAsyncThunk('auth/logoutUser', async () => {
  await authApi.logoutRequest()
})

export const refreshUser = createAsyncThunk('auth/refreshUser', async (_, { rejectWithValue }) => {
  try {
    const user = await authApi.fetchMeRequest()
    return user ?? null
  } catch (e) {
    return rejectWithValue(e.message || 'Failed to refresh user')
  }
})

const initialState = {
  user: null,
  status: 'idle',
  error: null,
  initialized: false,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /**
     * Synchronous logout — clears Redux state immediately.
     * Used by ApiAuthBridge when a 401 is received mid-session.
     * Cookie cleanup is best-effort and happens via logoutUser thunk in
     * normal flows; here we skip the API call to avoid a second 401.
     */
    logout(state) {
      state.user = null
      state.error = null
    },
    clearError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      // ── initializeAuth ────────────────────────────────────────────────
      .addCase(initializeAuth.pending, (state) => {
        state.status = 'loading'
      })
      .addCase(initializeAuth.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.initialized = true
        state.user = action.payload ?? null
      })
      .addCase(initializeAuth.rejected, (state) => {
        state.status = 'succeeded'
        state.initialized = true
        state.user = null
      })

      // ── login ─────────────────────────────────────────────────────────
      .addCase(login.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(login.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.user = action.payload
        state.initialized = true
        state.error = null
      })
      .addCase(login.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || 'Login failed'
      })

      // ── logoutUser ────────────────────────────────────────────────────
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null
        state.error = null
        state.status = 'idle'
      })
      .addCase(logoutUser.rejected, (state) => {
        // Network failed but we still clear local state
        state.user = null
        state.error = null
        state.status = 'idle'
      })

      .addCase(refreshUser.fulfilled, (state, action) => {
        if (action.payload) state.user = action.payload
      })
  },
})

export const { logout, clearError } = authSlice.actions
export const authReducer = authSlice.reducer

export function selectAuth(state) {
  return state.auth
}

export function selectUser(state) {
  return state.auth.user
}

export function selectIsAuthenticated(state) {
  return Boolean(state.auth.user)
}
