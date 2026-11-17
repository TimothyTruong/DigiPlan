import { createStore, del, get, set } from 'idb-keyval'
import { useEffect, useState } from 'react'
import { uid } from './id'

// Binary data (banners, icons, class files) lives outside the JSON state so state writes stay small and fast.
const store = createStore('petal-blobs', 'blobs')
const urlCache = new Map<string, string>()

export async function putBlob(blob: Blob, id = uid()): Promise<string> {
  await set(id, blob, store)
  return id
}
export async function getBlob(id: string): Promise<Blob | undefined> {
  return get<Blob>(id, store)
}
export async function deleteBlob(id: string): Promise<void> {
  const u = urlCache.get(id)
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id) }
  await del(id, store)
}

export async function blobUrl(id: string): Promise<string | undefined> {
  const hit = urlCache.get(id)
  if (hit) return hit
  const b = await getBlob(id)
  if (!b) return undefined
  const u = URL.createObjectURL(b)
  urlCache.set(id, u)
  return u
}

export function useBlobUrl(id?: string): string | undefined {
  const [url, setUrl] = useState(() => (id ? urlCache.get(id) : undefined))
  useEffect(() => {
    if (!id) { setUrl(undefined); return }
    let live = true
    blobUrl(id).then((u) => live && setUrl(u))
    return () => { live = false }
  }, [id])
  return url
}

/** Downscale + re-encode images before storing: a 6MB phone photo becomes ~200KB. */
export async function compressImage(file: File, maxDim: number, quality = 0.85): Promise<Blob> {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality))
  return out && out.size < file.size ? out : file
}
