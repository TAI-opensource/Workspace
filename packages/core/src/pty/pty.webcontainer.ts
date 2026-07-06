import type { Opts, Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  // PTY is not available in WebContainer environment
  // We create a mock process that simulates basic functionality
  const listeners: { type: string; callback: Function }[] = []
  let killed = false

  const mockProc: Proc = {
    pid: 0,
    onData(listener) {
      listeners.push({ type: "data", callback: listener })
      // Simulate initial output
      setTimeout(() => {
        if (!killed) {
          listener(`$ ${file} ${args.join(" ")}\r\n`)
          listener("PTY is not available in WebContainer environment.\r\n")
          listener("Use shell commands directly via node:child_process instead.\r\n")
        }
      }, 100)
      return () => {
        const idx = listeners.findIndex((l) => l.callback === listener)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    },
    onExit(listener) {
      listeners.push({ type: "exit", callback: listener })
      return () => {
        const idx = listeners.findIndex((l) => l.callback === listener)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    },
    write(data) {
      // No-op in WebContainer
    },
    resize(cols, rows) {
      // No-op in WebContainer
    },
    kill(signal) {
      killed = true
      const exitListeners = listeners.filter((l) => l.type === "exit")
      for (const l of exitListeners) {
        ;(l.callback as any)(-1, signal || "SIGTERM")
      }
    },
  }

  return mockProc
}
