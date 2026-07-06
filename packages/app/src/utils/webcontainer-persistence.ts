const DB_NAME = "opencode-webcontainer"
const DB_VERSION = 1

export class IndexedDBPersistence {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        
        // Create object stores
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files", { keyPath: "path" })
        }
        if (!db.objectStoreNames.contains("sessions")) {
          db.createObjectStore("sessions", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("messages")) {
          db.createObjectStore("messages", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" })
        }
      }
    })
  }

  async saveFile(path: string, content: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("files", "readwrite")
      const store = transaction.objectStore("files")
      const request = store.put({ path, content, timestamp: Date.now() })
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async getFile(path: string): Promise<string | null> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("files", "readonly")
      const store = transaction.objectStore("files")
      const request = store.get(path)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const result = request.result
        resolve(result ? result.content : null)
      }
    })
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("files", "readwrite")
      const store = transaction.objectStore("files")
      const request = store.delete(path)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async listFiles(): Promise<Array<{ path: string; timestamp: number }>> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("files", "readonly")
      const store = transaction.objectStore("files")
      const request = store.getAll()
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const results = request.result.map((item: any) => ({
          path: item.path,
          timestamp: item.timestamp,
        }))
        resolve(results)
      }
    })
  }

  async saveSession(id: string, data: any): Promise<void> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("sessions", "readwrite")
      const store = transaction.objectStore("sessions")
      const request = store.put({ id, ...data, timestamp: Date.now() })
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async getSession(id: string): Promise<any | null> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("sessions", "readonly")
      const store = transaction.objectStore("sessions")
      const request = store.get(id)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || null)
    })
  }

  async saveMessage(id: string, data: any): Promise<void> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("messages", "readwrite")
      const store = transaction.objectStore("messages")
      const request = store.put({ id, ...data, timestamp: Date.now() })
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async getMessage(id: string): Promise<any | null> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("messages", "readonly")
      const store = transaction.objectStore("messages")
      const request = store.get(id)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || null)
    })
  }

  async saveSetting(key: string, value: any): Promise<void> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("settings", "readwrite")
      const store = transaction.objectStore("settings")
      const request = store.put({ key, value, timestamp: Date.now() })
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async getSetting(key: string): Promise<any | null> {
    if (!this.db) throw new Error("Database not initialized")
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction("settings", "readonly")
      const store = transaction.objectStore("settings")
      const request = store.get(key)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const result = request.result
        resolve(result ? result.value : null)
      }
    })
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized")
    
    const stores = ["files", "sessions", "messages", "settings"]
    for (const storeName of stores) {
      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction(storeName, "readwrite")
        const store = transaction.objectStore(storeName)
        const request = store.clear()
        
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

export async function createIndexedDBPersistence(): Promise<IndexedDBPersistence> {
  const persistence = new IndexedDBPersistence()
  await persistence.init()
  return persistence
}
