import type { WebContainer } from "@webcontainer/api"

type BootState = "idle" | "mounting" | "installing" | "starting" | "ready" | "error"

type BootCallbacks = {
  onState?: (state: BootState) => void
  onOutput?: (line: string) => void
  onError?: (error: string) => void
}

// Minimal server code that runs in WebContainer
const SERVER_CODE = `
import { createServer } from "node:http";
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";

const PORT = parseInt(process.env.PORT || "3000");
const HOSTNAME = process.env.HOSTNAME || "0.0.0.0";
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/workspace";

// Simple in-memory database
const db = {
  sessions: new Map(),
  messages: new Map(),
  parts: new Map(),
};

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-opencode-directory",
  "Access-Control-Expose-Headers": "x-opencode-directory",
};

// JSON response helper
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// Error response helper
function error(message, status = 500) {
  return json({ error: message }, status);
}

// Parse request body
async function parseBody(request) {
  const contentType = request.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return await request.json();
  }
  return null;
}

// Generate ID
function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Route handlers
const routes = {
  "GET /": async () => {
    return json({ status: "ok", version: "1.0.0-webcontainer" });
  },
  "GET /session": async () => {
    const sessions = Array.from(db.sessions.values());
    return json(sessions);
  },
  "POST /session": async (request) => {
    const body = await parseBody(request);
    const id = generateId();
    const session = {
      id,
      title: body?.title || "New Session",
      directory: body?.directory || WORKSPACE_DIR,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    db.sessions.set(id, session);
    db.messages.set(id, []);
    return json(session, 201);
  },
  "GET /session/:id": async (request, params) => {
    const session = db.sessions.get(params.id);
    if (!session) return error("Session not found", 404);
    return json(session);
  },
  "DELETE /session/:id": async (request, params) => {
    if (!db.sessions.has(params.id)) return error("Session not found", 404);
    db.sessions.delete(params.id);
    db.messages.delete(params.id);
    db.parts.delete(params.id);
    return json({ success: true });
  },
  "GET /session/:id/message": async (request, params) => {
    const messages = db.messages.get(params.id) || [];
    return json(messages);
  },
  "POST /session/:id/message": async (request, params) => {
    const body = await parseBody(request);
    const messages = db.messages.get(params.id) || [];
    const message = {
      id: generateId(),
      session_id: params.id,
      role: body?.role || "user",
      content: body?.content || "",
      created_at: Date.now(),
    };
    messages.push(message);
    db.messages.set(params.id, messages);
    return json(message, 201);
  },
  "GET /session/:id/message/:messageId/part": async (request, params) => {
    const parts = db.parts.get(params.messageId) || [];
    return json(parts);
  },
  "POST /session/:id/message/:messageId/part": async (request, params) => {
    const body = await parseBody(request);
    const parts = db.parts.get(params.messageId) || [];
    const part = {
      id: generateId(),
      message_id: params.messageId,
      type: body?.type || "text",
      content: body?.content || "",
      created_at: Date.now(),
    };
    parts.push(part);
    db.parts.set(params.messageId, parts);
    return json(part, 201);
  },
  "GET /files": async (request) => {
    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "/";
    const fullPath = join(WORKSPACE_DIR, path);
    try {
      const entries = await readdir(fullPath, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = join(fullPath, entry.name);
          const stats = await stat(entryPath);
          return {
            name: entry.name,
            path: join(path, entry.name),
            isDirectory: entry.isDirectory(),
            size: stats.size,
            modified: stats.mtime.toISOString(),
          };
        })
      );
      return json(files);
    } catch {
      return error("Directory not found", 404);
    }
  },
  "GET /file": async (request) => {
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (!path) return error("Path required", 400);
    const fullPath = join(WORKSPACE_DIR, path);
    try {
      const content = await readFile(fullPath, "utf-8");
      return json({ path, content });
    } catch {
      return error("File not found", 404);
    }
  },
  "POST /file": async (request) => {
    const body = await parseBody(request);
    if (!body?.path || body.content === undefined) return error("Path and content required", 400);
    const fullPath = join(WORKSPACE_DIR, body.path);
    const dir = dirname(fullPath);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, body.content, "utf-8");
      return json({ success: true });
    } catch (e) {
      return error("Failed to write file");
    }
  },
};

// Match route pattern
function matchRoute(pattern, method, path) {
  const [routeMethod, routePattern] = pattern.split(" ");
  if (routeMethod !== method) return { matched: false, params: {} };
  const routeParts = routePattern.split("/");
  const pathParts = path.split("/");
  if (routeParts.length !== pathParts.length) return { matched: false, params: {} };
  const params = {};
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(":")) {
      params[routeParts[i].slice(1)] = pathParts[i];
    } else if (routeParts[i] !== pathParts[i]) {
      return { matched: false, params: {} };
    }
  }
  return { matched: true, params };
}

// Request handler
async function handler(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  for (const [pattern, handler] of Object.entries(routes)) {
    const { matched, params } = matchRoute(pattern, method, path);
    if (matched) {
      try {
        return await handler(request, params);
      } catch (e) {
        console.error("Handler error:", e);
        return error("Internal server error");
      }
    }
  }
  return error("Not found", 404);
}

// Create server
const server = createServer((req, res) => {
  const request = new Request(\`http://\${req.headers.host || "localhost"}\${req.url}\`, {
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => typeof k === "string")),
    body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
  });
  handler(request).then(
    async (response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      const body = await response.text();
      res.end(body);
    },
    (err) => {
      console.error("Server error:", err);
      res.writeHead(500);
      res.end("Internal server error");
    }
  );
});

server.listen(PORT, HOSTNAME, () => {
  console.log(\`OpenCode WebContainer server listening on http://\${HOSTNAME}:\${PORT}\`);
});
`

export async function bootOpenCode(container: WebContainer, callbacks?: BootCallbacks) {
  const emit = (state: BootState) => callbacks?.onState?.(state)
  const log = (line: string) => callbacks?.onOutput?.(line)
  const err = (error: string) => callbacks?.onError?.(error)

  try {
    emit("mounting")
    log("Mounting filesystem...")

    // Write the server code
    await container.mount({
      "server.mjs": { file: { contents: SERVER_CODE } },
    })

    emit("starting")
    log("Starting OpenCode server...")

    // Start the server
    const serverProcess = await container.spawn("node", [
      "--experimental-vm-modules",
      "server.mjs",
    ])

    serverProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          log(data)
          if (data.includes("listening on")) {
            emit("ready")
          }
        },
      }),
    )

    const serverExit = await serverProcess.exit
    if (serverExit !== 0) {
      throw new Error(`Server exited with code ${serverExit}`)
    }

    return {
      stop: async () => {
        await serverProcess.kill()
      },
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    err(message)
    emit("error")
    throw e
  }
}

export async function mountWorkspace(container: WebContainer, files: Record<string, string>) {
  const fileTree: Record<string, { file: { contents: string } }> = {}
  for (const [path, content] of Object.entries(files)) {
    fileTree[path] = { file: { contents: content } }
  }
  await container.mount(fileTree, { mode: "keep" })
}

export async function readFile(container: WebContainer, path: string): Promise<string> {
  return await container.fs.readFile(path, "utf-8")
}

export async function writeFile(container: WebContainer, path: string, content: string): Promise<void> {
  await container.fs.writeFile(path, content)
}

export async function listDir(container: WebContainer, path: string): Promise<string[]> {
  return await container.fs.readdir(path)
}
