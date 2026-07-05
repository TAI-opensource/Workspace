import { WebContainerFileSystem } from "./webcontainer-fs"

type WatcherCallback = (event: { type: "create" | "modify" | "delete"; path: string }) => void

export class WebContainerFileWatcher {
  private fs: WebContainerFileSystem
  private callbacks: WatcherCallback[] = []
  private polling = false
  private pollInterval = 1000
  private knownFiles: Map<string, number> = new Map()

  constructor(fs: WebContainerFileSystem) {
    this.fs = fs
  }

  async watch(dir: string, callback: WatcherCallback): Promise<() => void> {
    this.callbacks.push(callback)
    
    // Initial scan
    await this.scanDirectory(dir)
    
    // Start polling if not already running
    if (!this.polling) {
      this.startPolling(dir)
    }

    // Return unsubscribe function
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback)
      if (this.callbacks.length === 0) {
        this.stopPolling()
      }
    }
  }

  private async scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await this.fs.readdir(dir)
      
      for (const entry of entries) {
        const fullPath = `${dir}/${entry}`
        try {
          const stat = await this.fs.stat(fullPath)
          const mtime = stat.mtime.getTime()
          
          if (stat.isDirectory()) {
            await this.scanDirectory(fullPath)
          } else {
            const known = this.knownFiles.get(fullPath)
            if (known === undefined) {
              // New file
              this.notify({ type: "create", path: fullPath })
            } else if (known !== mtime) {
              // Modified file
              this.notify({ type: "modify", path: fullPath })
            }
            this.knownFiles.set(fullPath, mtime)
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }

      // Check for deleted files
      for (const [path, mtime] of this.knownFiles.entries()) {
        if (path.startsWith(dir)) {
          try {
            await this.fs.stat(path)
          } catch {
            // File was deleted
            this.notify({ type: "delete", path })
            this.knownFiles.delete(path)
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  private startPolling(dir: string): void {
    this.polling = true
    const poll = async () => {
      if (!this.polling) return
      await this.scanDirectory(dir)
      setTimeout(poll, this.pollInterval)
    }
    poll()
  }

  private stopPolling(): void {
    this.polling = false
  }

  private notify(event: { type: "create" | "modify" | "delete"; path: string }): void {
    for (const callback of this.callbacks) {
      try {
        callback(event)
      } catch (e) {
        console.error("Watcher callback error:", e)
      }
    }
  }

  setPollInterval(ms: number): void {
    this.pollInterval = ms
  }
}

export function createWebContainerFileWatcher(fs: WebContainerFileSystem): WebContainerFileWatcher {
  return new WebContainerFileWatcher(fs)
}
