const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api"

export type Portal = "external" | "internal"

export type ApiSession = {
  access: string
  refresh: string
  user: {
    id: number
    username: string
    first_name: string
    last_name: string
    email: string
    profile: {
      role: string
      roleLabel: string
      portal: Portal
      phone: string
      organization: number | null
      organizationName: string
      province: number | null
      provinceName: string
      district: number | null
      districtName: string
      ward: number | null
      wardName: string
      active: boolean
      must_change_password: boolean
    }
  }
}

export type PasswordChangeRequired = {
  passwordChangeRequired: true
  user: ApiSession["user"]
}

function sessionStore() {
  return window.sessionStorage
}

function clearSharedSession() {
  window.localStorage.removeItem("ncms_access_token")
  window.localStorage.removeItem("ncms_refresh_token")
  window.localStorage.removeItem("ncms_user")
}

function authHeaders(): Record<string, string> {
  const token = sessionStore().getItem("ncms_access_token")
  return token ? { Authorization: `Bearer ${token}` } : {}
}

type ApiRequestOptions = RequestInit & {
  skipAuth?: boolean
}

function authErrorMessage() {
  return "Your session has expired. Please sign in again to continue."
}

function responseErrorMessage(status: number, body: unknown) {
  if (status === 403) return "You do not have permission to complete this action. Please contact your supervisor if you need access."
  if (status === 404) return "The requested information could not be found. It may have been moved or removed."
  if (status >= 500) return "The system could not complete your request right now. Please wait a moment and try again."
  return getErrorDetail(body) || "The request could not be completed. Please check the information and try again."
}

function getErrorDetail(body: unknown): string {
  if (!body) return ""
  if (typeof body === "string") return body
  if (Array.isArray(body)) return body.map(getErrorDetail).filter(Boolean).join(" ")
  if (typeof body !== "object") return ""

  const record = body as Record<string, unknown>
  const detail = record.detail
  if (detail) return getErrorDetail(detail)

  const nonFieldErrors = record.non_field_errors
  if (nonFieldErrors) return getErrorDetail(nonFieldErrors)

  return Object.entries(record)
    .map(([key, value]) => {
      const message = getErrorDetail(value)
      if (!message) return ""
      const label = key.replace(/_/g, " ")
      return `${label}: ${message}`
    })
    .filter(Boolean)
    .join(" ")
}

async function refreshAccessToken() {
  const refresh = sessionStore().getItem("ncms_refresh_token")
  if (!refresh) return false

  const response = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh }),
  })

  if (!response.ok) {
    apiLogout()
    return false
  }

  const session = (await response.json()) as { access?: string; refresh?: string }
  if (!session.access) {
    apiLogout()
    return false
  }

  sessionStore().setItem("ncms_access_token", session.access)
  if (session.refresh) sessionStore().setItem("ncms_refresh_token", session.refresh)
  return true
}

async function fetchJson(path: string, options: RequestInit, skipAuth: boolean): Promise<Response> {
  // Some upstream proxies have cached an empty master-data list despite the
  // no-store response headers. Give every API read a unique URL as well, so a
  // stale response can never make existing Province/District records vanish
  // from an administrator's table.
  const requestPath = (options.method || "GET").toUpperCase() === "GET"
    ? `${path}${path.includes("?") ? "&" : "?"}_ncms=${Date.now()}`
    : path

  return fetch(`${API_BASE_URL}${requestPath}`, {
    ...options,
    // Master data is changed by administrators during a session. Never reuse a
    // cached API response, otherwise a previously empty Province/District list
    // can overwrite the record that was just created.
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(skipAuth ? {} : authHeaders()),
      ...options.headers,
    },
  })
}

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { skipAuth, ...fetchOptions } = options
  let response: Response

  try {
    response = await fetchJson(path, fetchOptions, Boolean(skipAuth))
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Unable to reach the NCPMIS server. Check the connection and try again.")
    }
    throw error
  }

  if (response.status === 401 && !skipAuth && (await refreshAccessToken())) {
    response = await fetchJson(path, fetchOptions, false)
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    if (response.status === 401) {
      apiLogout()
      throw new Error(authErrorMessage())
    }
    throw new Error(responseErrorMessage(response.status, body))
  }

  if (response.status === 204) return undefined as T
  return await response.json() as T
}

function storeSession(session: ApiSession) {
  clearSharedSession()
  sessionStore().setItem("ncms_access_token", session.access)
  sessionStore().setItem("ncms_refresh_token", session.refresh)
  sessionStore().setItem("ncms_user", JSON.stringify(session.user))
}

export async function apiLogin(username: string, password: string, portal: Portal) {
  apiLogout()
  const session = await request<ApiSession | PasswordChangeRequired>("/auth/login/", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify({ username, password, portal }),
  })
  if ("passwordChangeRequired" in session) return session
  storeSession(session)
  return session
}

export async function apiChangePassword(username: string, currentPassword: string, newPassword: string, confirmPassword: string, portal: Portal) {
  apiLogout()
  const session = await request<ApiSession>("/auth/change-password/", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify({
      username,
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
      portal,
    }),
  })
  storeSession(session)
  return session
}

export function apiLogout() {
  sessionStore().removeItem("ncms_access_token")
  sessionStore().removeItem("ncms_refresh_token")
  sessionStore().removeItem("ncms_user")
  clearSharedSession()
}

export function currentUser() {
  clearSharedSession()
  const user = sessionStore().getItem("ncms_user")
  if (!user) return null
  try {
    const parsed = JSON.parse(user) as ApiSession["user"]
    if (!parsed?.profile?.portal) {
      apiLogout()
      return null
    }
    return parsed
  } catch {
    apiLogout()
    return null
  }
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export async function apiBlob(path: string): Promise<Blob> {
  let response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    headers: {
      Accept: "*/*",
      "Cache-Control": "no-store",
      ...authHeaders(),
    },
  })
  if (response.status === 401 && (await refreshAccessToken())) {
    response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      headers: {
        Accept: "*/*",
        "Cache-Control": "no-store",
        ...authHeaders(),
      },
    })
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    if (response.status === 401) {
      apiLogout()
      throw new Error(authErrorMessage())
    }
    throw new Error(responseErrorMessage(response.status, body))
  }
  return response.blob()
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) })
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) })
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" })
}
