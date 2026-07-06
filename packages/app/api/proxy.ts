import type { IncomingMessage, ServerResponse } from "node:http"

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  // Set CORS headers on all responses
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value)
  }

  // Get target URL from X-WC-URL header
  const wcUrl = req.headers["x-wc-url"] as string | undefined
  if (!wcUrl) {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Missing X-WC-URL header" }))
    return
  }

  // Build target URL: base URL + request path + query string
  const originalUrl = req.url || "/"
  const pathAndQuery = originalUrl.startsWith("/api/proxy")
    ? originalUrl.slice("/api/proxy".length) || "/"
    : originalUrl
  const targetUrl = new URL(pathAndQuery, wcUrl)

  // Read request body if present
  let body: Buffer | undefined
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    }
    if (chunks.length > 0) body = Buffer.concat(chunks)
  }

  // Build fetch headers (forward content-type and x-opencode-directory)
  const fetchHeaders: Record<string, string> = {}
  for (const key of ["content-type", "x-opencode-directory", "authorization"]) {
    const val = req.headers[key]
    if (val) fetchHeaders[key] = Array.isArray(val) ? val[0] : val
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: fetchHeaders,
      body: body ?? undefined,
    })

    // Forward response headers (especially x-opencode-directory)
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (lower === "access-control-allow-origin") return // skip, we set our own
      res.setHeader(key, value)
    })

    res.writeHead(response.status)

    if (response.body) {
      const reader = response.body.getReader()
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read()
        if (done) {
          res.end()
          return
        }
        res.write(value)
        return pump()
      }
      await pump()
    } else {
      res.end()
    }
  } catch (e) {
    console.error("[wc-proxy] Error:", e)
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" })
    }
    res.end(JSON.stringify({ error: "Failed to reach WebContainer server" }))
  }
}
