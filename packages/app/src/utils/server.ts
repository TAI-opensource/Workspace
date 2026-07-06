import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function isWebContainerEnv() {
  try {
    return typeof SharedArrayBuffer !== "undefined" && location.hostname.includes("vercel.app")
  } catch {
    return false
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  const isWc = isWebContainerEnv()

  if (isWc) {
    const baseHeaders = {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    }

    const wrappedFetch: typeof fetch = (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init)
      const reqUrl = new URL(req.url)
      const pathAndQuery = reqUrl.pathname + reqUrl.search
      const fullTargetUrl = server.url + pathAndQuery
      const newReq = new Request("/api/proxy", {
        method: req.method,
        headers: req.headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      })
      newReq.headers.set("X-WC-URL", fullTargetUrl)
      return fetch(newReq)
    }

    return createOpencodeClient({
      ...config,
      fetch: wrappedFetch,
      headers: baseHeaders,
      baseUrl: "/api/proxy",
    })
  }

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}
