import type { WebContainer } from "@webcontainer/api"

export class WebContainerFileSystem {
  constructor(private container: WebContainer) {}

  async readFile(path: string): Promise<string> {
    return await this.container.fs.readFile(path, "utf-8")
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.container.fs.writeFile(path, content)
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.container.fs.stat(path)
      return true
    } catch {
      return false
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.container.fs.mkdir(path, { recursive: true })
  }

  async readdir(path: string): Promise<string[]> {
    return await this.container.fs.readdir(path)
  }

  async stat(path: string) {
    return await this.container.fs.stat(path)
  }

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.container.fs.rm(path, options)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.container.fs.rename(oldPath, newPath)
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const content = await this.readFile(src)
    await this.writeFile(dest, content)
  }

  async mountFiles(files: Record<string, string>): Promise<void> {
    const fileTree: Record<string, { file: { contents: string } }> = {}
    for (const [path, content] of Object.entries(files)) {
      fileTree[path] = { file: { contents: content } }
    }
    await this.container.mount(fileTree, { mode: "keep" })
  }

  async readFileTree(path: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {}
    const entries = await this.readdir(path)
    
    for (const entry of entries) {
      const fullPath = `${path}/${entry}`
      try {
        const stat = await this.stat(fullPath)
        if (stat.isDirectory()) {
          const subFiles = await this.readFileTree(fullPath)
          Object.assign(files, subFiles)
        } else {
          files[fullPath] = await this.readFile(fullPath)
        }
      } catch {
        // Skip files that can't be read
      }
    }
    
    return files
  }
}

export function createWebContainerFileSystem(container: WebContainer): WebContainerFileSystem {
  return new WebContainerFileSystem(container)
}
