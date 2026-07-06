import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const port = Number(process.env.OPENCODE_PORT || "3000")
const hostname = process.env.OPENCODE_HOSTNAME || "0.0.0.0"

console.log(`Starting OpenCode server on port ${port}...`)

let handlerPromise: Promise<{ app: { fetch(request: Request): Response | Promise<Response> } }> | null = null

function ensureHandler() {
  if (!handlerPromise) {
    handlerPromise = import("./server").then(({ Default }) => Default)
  }
  return handlerPromise
}

// Preload handler in background (non-blocking)
ensureHandler().catch((e) => console.error("Handler init error:", e))

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "*")
  res.setHeader("Access-Control-Allow-Headers", "*")
  res.setHeader("Access-Control-Max-Age", "86400")

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    const { app } = await ensureHandler()

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }

    let body: ReadableStream | null = null
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
      }
      const buf = Buffer.concat(chunks)
      if (buf.length > 0) {
        body = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(buf))
            controller.close()
          },
        })
      }
    }

    const request = new Request(url, { method: req.method, headers, body })
    const response = await app.fetch(request)

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })
    responseHeaders["access-control-allow-origin"] = "*"

    res.writeHead(response.status, responseHeaders)

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
    console.error("Request handler error:", e)
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" })
    }
    res.end("Server starting...")
  }
})

server.listen(port, hostname, () => {
  console.log(`opencode server listening on http://${hostname}:${port}`)
})
