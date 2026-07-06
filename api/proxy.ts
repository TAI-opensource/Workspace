export const config = {
  runtime: "edge",
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const wcUrl = req.headers.get("X-WC-URL")
  if (!wcUrl) {
    return new Response(JSON.stringify({ error: "Missing X-WC-URL header" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  }

  const fetchHeaders = new Headers()
  for (const key of ["content-type", "x-opencode-directory", "authorization"]) {
    const val = req.headers.get(key)
    if (val) fetchHeaders.set(key, val)
  }

  try {
    const response = await fetch(wcUrl, {
      method: req.method,
      headers: fetchHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    })

    const respHeaders = new Headers(CORS_HEADERS)
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "access-control-allow-origin") return
      respHeaders.set(key, value)
    })

    return new Response(response.body, {
      status: response.status,
      headers: respHeaders,
    })
  } catch (e) {
    console.error("[wc-proxy] Error:", e)
    return new Response(JSON.stringify({ error: "Failed to reach WebContainer server" }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  }
}
