import git from "isomorphic-git"
import { WebContainerFileSystem } from "./webcontainer-fs"

export class WebContainerGit {
  private fs: WebContainerFileSystem
  private dir: string

  constructor(fs: WebContainerFileSystem, dir: string) {
    this.fs = fs
    this.dir = dir
  }

  async init(): Promise<void> {
    await git.init({
      fs: this.createFsAdapter(),
      dir: this.dir,
    })
  }

  async clone(url: string): Promise<void> {
    await git.clone({
      fs: this.createFsAdapter(),
      dir: this.dir,
      url,
    })
  }

  async status(): Promise<string[]> {
    return await git.statusMatrix({
      fs: this.createFsAdapter(),
      dir: this.dir,
    })
  }

  async add(filepaths: string[]): Promise<void> {
    for (const filepath of filepaths) {
      await git.add({
        fs: this.createFsAdapter(),
        dir: this.dir,
        filepath,
      })
    }
  }

  async commit(message: string): Promise<string> {
    const sha = await git.commit({
      fs: this.createFsAdapter(),
      dir: this.dir,
      message,
    })
    return sha
  }

  async log(): Promise<Array<{ oid: string; message: string; author: { name: string; email: string; timestamp: number } }>> {
    return await git.log({
      fs: this.createFsAdapter(),
      dir: this.dir,
    })
  }

  async branch(name: string): Promise<void> {
    await git.branch({
      fs: this.createFsAdapter(),
      dir: this.dir,
      ref: name,
    })
  }

  async checkout(branch: string): Promise<void> {
    await git.checkout({
      fs: this.createFsAdapter(),
      dir: this.dir,
      ref: branch,
    })
  }

  async currentBranch(): Promise<string | null> {
    return await git.currentBranch({
      fs: this.createFsAdapter(),
      dir: this.dir,
    })
  }

  async remoteAdd(name: string, url: string): Promise<void> {
    await git.remote.add({
      fs: this.createFsAdapter(),
      dir: this.dir,
      remote: name,
      url,
    })
  }

  async push(remote: string, branch: string): Promise<void> {
    await git.push({
      fs: this.createFsAdapter(),
      dir: this.dir,
      remote,
      ref: branch,
    })
  }

  async pull(): Promise<void> {
    await git.pull({
      fs: this.createFsAdapter(),
      dir: this.dir,
    })
  }

  async readFile(path: string): Promise<string> {
    return await git.readBlob({
      fs: this.createFsAdapter(),
      dir: this.dir,
      filepath: path,
    }).then(result => new TextDecoder().decode(result.blob))
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.fs.writeFile(`${this.dir}/${path}`, content)
  }

  private createFsAdapter() {
    return {
      readFile: async (path: string) => {
        const content = await this.fs.readFile(path)
        return new TextEncoder().encode(content)
      },
      writeFile: async (path: string, data: Uint8Array) => {
        const content = new TextDecoder().decode(data)
        await this.fs.writeFile(path, content)
      },
      mkdir: async (path: string) => {
        await this.fs.mkdir(path)
      },
      rm: async (path: string) => {
        await this.fs.rm(path)
      },
      readdir: async (path: string) => {
        return await this.fs.readdir(path)
      },
      stat: async (path: string) => {
        const stat = await this.fs.stat(path)
        return {
          isFile: () => !stat.isDirectory(),
          isDirectory: () => stat.isDirectory(),
          isSymbolicLink: () => false,
        }
      },
    }
  }
}

export function createWebContainerGit(fs: WebContainerFileSystem, dir: string): WebContainerGit {
  return new WebContainerGit(fs, dir)
}
