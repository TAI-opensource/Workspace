import { listen } from "./server"
import { Flag } from "@opencode-ai/core/flag/flag"

if (!Flag.OPENCODE_SERVER_PASSWORD) {
  console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
}

const port = Number(process.env.OPENCODE_PORT || "3000")
const hostname = process.env.OPENCODE_HOSTNAME || "0.0.0.0"

console.log(`Starting OpenCode server on port ${port}...`)

const server = await listen({ port, hostname })
console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
