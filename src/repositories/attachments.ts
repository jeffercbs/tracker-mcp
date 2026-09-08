import { basename, resolve } from "node:path"
import { readFile, stat } from "node:fs/promises"
import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"

export const ATTACHMENTS_BUCKET = "attachments"

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export interface AttachmentDTO {
  id: string
  issueId: string | null
  filename: string
  size: number | null
  mimeType: string | null
  createdBy: string
  createdAt: string
  url: string | null
}

const SELECT_COLUMNS =
  "id, issue_id, storage_path, filename, size, mime_type, created_by, created_at"

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  log: "text/plain",
  json: "application/json",
  csv: "text/csv",
  zip: "application/zip",
  mp4: "video/mp4",
  webm: "video/webm",
}

export function guessMimeType(filename: string): string | undefined {
  const extension = filename.split(".").pop()?.toLowerCase()
  return extension ? MIME_BY_EXTENSION[extension] : undefined
}

export function sanitizeFilename(filename: string) {
  const base = filename.trim().split(/[\\/]/).pop() ?? ""
  const trimmed = base.slice(-120).replace(/^\.+/, "")
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_") || "archivo"
}

const BLOCKED_FILENAMES = [
  /^\.env(\..*)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^credentials$/i,
  /^\.git-credentials$/i,
  /^.*\.env$/i,
  /^\.pgpass$/i,
  /^\.dockercfg$/i,
  /^session\.json$/i,
  /^.*\.tfvars$/i,
  /^known_hosts$/i,
]

const BLOCKED_EXTENSIONS = new Set(["pem", "key", "p12", "pfx", "keystore", "jks", "ppk"])

const BLOCKED_DIRECTORIES = [
  /(^|\/)\.ssh\//i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.gnupg\//i,
  /(^|\/)\.my-tracker-mcp\//i,
  /(^|\/)\.tracker-mcp\//i,
]

function assertUploadAllowed(originalName: string) {
  const normalized = originalName.replace(/\\/g, "/")
  const base = originalName.trim().split(/[\\/]/).pop() ?? ""
  const extension = base.includes(".") ? base.split(".").pop()!.toLowerCase() : ""

  if (
    BLOCKED_FILENAMES.some((pattern) => pattern.test(base)) ||
    BLOCKED_EXTENSIONS.has(extension) ||
    BLOCKED_DIRECTORIES.some((pattern) => pattern.test(normalized))
  ) {
    throw new Error(
      `"${base}" parece un fichero de credenciales o de configuración sensible, así que no se sube. Adjunta solo evidencia (capturas, registros ya depurados, documentos).`
    )
  }
}

const SIGNED_URL_TTL_SECONDS = 60 * 60

async function signedUrl(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) {
    return null
  }
  return data.signedUrl
}

async function signedUrls(
  client: SupabaseClient,
  paths: string[]
): Promise<Map<string, string | null>> {
  const urls = new Map<string, string | null>()
  if (paths.length === 0) return urls

  const { data, error } = await client.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)

  if (error || !data) {
    for (const path of paths) urls.set(path, null)
    return urls
  }

  for (const entry of data) {
    urls.set(entry.path ?? "", entry.signedUrl ?? null)
  }
  return urls
}

function mapAttachment(row: any, url: string | null): AttachmentDTO {
  return {
    id: row.id,
    issueId: row.issue_id,
    filename: row.filename,
    size: row.size,
    mimeType: row.mime_type,
    createdBy: row.created_by,
    createdAt: row.created_at,
    url,
  }
}

export async function listAttachmentsForIssue(
  client: SupabaseClient,
  issueId: string
): Promise<AttachmentDTO[]> {
  const { data, error } = await client
    .from("attachments")
    .select(SELECT_COLUMNS)
    .eq("issue_id", issueId)
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los adjuntos", error))
  }

  const rows = data ?? []
  const urls = await signedUrls(
    client,
    rows.map((row: any) => row.storage_path)
  )
  return rows.map((row: any) => mapAttachment(row, urls.get(row.storage_path) ?? null))
}

export interface AttachmentSource {
  filePath?: string
  base64?: string
  filename?: string
  mimeType?: string
}

async function readSource(source: AttachmentSource): Promise<{
  bytes: Uint8Array
  filename: string
  mimeType: string | undefined
}> {
  if (source.filePath) {
    const path = resolve(source.filePath)
    assertUploadAllowed(source.filename ?? basename(path))

    const info = await stat(path).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        throw new Error(`No existe el archivo "${source.filePath}"`)
      }
      throw new Error(`No se pudo leer "${source.filePath}": ${err.message}`)
    })
    if (!info.isFile()) {
      throw new Error(`"${source.filePath}" no es un archivo`)
    }
    if (info.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `El archivo supera el límite de ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`
      )
    }

    const bytes = await readFile(path).catch((err: NodeJS.ErrnoException) => {
      throw new Error(`No se pudo leer "${source.filePath}": ${err.message}`)
    })
    const filename = sanitizeFilename(source.filename ?? basename(path))
    return { bytes, filename, mimeType: source.mimeType ?? guessMimeType(filename) }
  }

  if (source.base64) {
    if (!source.filename) {
      throw new Error("Con `base64` también hay que enviar `filename`")
    }
    assertUploadAllowed(source.filename)
    const bytes = Buffer.from(source.base64, "base64")
    const filename = sanitizeFilename(source.filename)
    return { bytes, filename, mimeType: source.mimeType ?? guessMimeType(filename) }
  }

  throw new Error("Hay que enviar `filePath` o `base64`")
}

export async function uploadIssueAttachment(
  client: SupabaseClient,
  input: {
    projectId: string
    issueId: string
    createdBy: string
    source: AttachmentSource
  }
): Promise<AttachmentDTO> {
  const { bytes, filename, mimeType } = await readSource(input.source)

  if (bytes.byteLength === 0) {
    throw new Error("El archivo está vacío")
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(
      `El archivo supera el límite de ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`
    )
  }

  const path = `${input.projectId}/${input.issueId}/${crypto.randomUUID()}-${filename}`

  const { error: uploadError } = await client.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: false })

  if (uploadError) {
    throw new Error(`No se pudo subir el archivo: ${uploadError.message}`)
  }

  const { data, error } = await client
    .from("attachments")
    .insert({
      issue_id: input.issueId,
      storage_path: path,
      filename,
      size: bytes.byteLength,
      mime_type: mimeType ?? null,
      created_by: input.createdBy,
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    await client.storage.from(ATTACHMENTS_BUCKET).remove([path])
    throw new Error(dbErrorMessage("No se pudo guardar el adjunto", error))
  }

  return mapAttachment(data, await signedUrl(client, path))
}

export async function deleteAttachment(client: SupabaseClient, attachmentId: string) {
  const { data: attachment, error: fetchError } = await client
    .from("attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle()

  if (fetchError || !attachment) {
    throw new Error(dbErrorMessage("No se encontró el adjunto", fetchError))
  }

  const { error } = await client.from("attachments").delete().eq("id", attachmentId)
  if (error) {
    throw new Error(dbErrorMessage("No se pudo eliminar el adjunto", error))
  }

  await client.storage.from(ATTACHMENTS_BUCKET).remove([attachment.storage_path])
}
