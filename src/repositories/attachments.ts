import { basename } from "node:path"
import { readFile } from "node:fs/promises"
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
  const trimmed = filename.trim().slice(-120)
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_") || "archivo"
}

async function signedUrl(client: SupabaseClient, path: string, expiresInSeconds = 60 * 60) {
  const { data, error } = await client.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds)
  if (error || !data) {
    return null
  }
  return data.signedUrl
}

function mapAttachment(client: SupabaseClient, row: any): Promise<AttachmentDTO> {
  return signedUrl(client, row.storage_path).then((url) => ({
    id: row.id,
    issueId: row.issue_id,
    filename: row.filename,
    size: row.size,
    mimeType: row.mime_type,
    createdBy: row.created_by,
    createdAt: row.created_at,
    url,
  }))
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

  return Promise.all((data ?? []).map((row) => mapAttachment(client, row)))
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
    const bytes = await readFile(source.filePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        throw new Error(`No existe el archivo "${source.filePath}"`)
      }
      throw new Error(`No se pudo leer "${source.filePath}": ${err.message}`)
    })
    const filename = sanitizeFilename(source.filename ?? basename(source.filePath))
    return { bytes, filename, mimeType: source.mimeType ?? guessMimeType(filename) }
  }

  if (source.base64) {
    if (!source.filename) {
      throw new Error("Con `base64` también hay que enviar `filename`")
    }
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

  return mapAttachment(client, data)
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
