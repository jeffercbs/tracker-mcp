import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { hostname, homedir, platform, userInfo } from "node:os"
import { dirname, join } from "node:path"

const ENVELOPE_VERSION = 1
const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32
const IV_LENGTH = 12
const SALT_LENGTH = 16
const SCRYPT_COST = 16384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1

export const PASSPHRASE_ENV = "TRACKER_MCP_SECRET"

interface Envelope {
  v: number
  alg: string
  kdf: string
  salt: string
  iv: string
  tag: string
  data: string
}

function machineBinding(): string {
  let username = ""
  try {
    username = userInfo().username
  } catch {
  }

  return createHash("sha256")
    .update([hostname(), username, homedir(), platform(), process.env[PASSPHRASE_ENV] ?? ""].join("\u0000"))
    .digest("hex")
}

const keyCache = new Map<string, Buffer>()

function deriveKey(salt: Buffer): Buffer {
  const cacheKey = salt.toString("base64")
  const cached = keyCache.get(cacheKey)
  if (cached) return cached

  const key = scryptSync(machineBinding(), salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  })
  keyCache.set(cacheKey, key)
  return key
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.v === ENVELOPE_VERSION &&
    candidate.alg === ALGORITHM &&
    typeof candidate.salt === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.data === "string"
  )
}

function encrypt(plaintext: string, aad: string): Envelope {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, deriveKey(salt), iv, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(`${aad}:${ENVELOPE_VERSION}`, "utf8"))

  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])

  return {
    v: ENVELOPE_VERSION,
    alg: ALGORITHM,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  }
}

function decrypt(envelope: Envelope, aad: string): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(Buffer.from(envelope.salt, "base64")),
    Buffer.from(envelope.iv, "base64"),
    { authTagLength: 16 }
  )
  decipher.setAAD(Buffer.from(`${aad}:${ENVELOPE_VERSION}`, "utf8"))
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

export interface SecureRead {
  raw: string
  legacy: boolean
}

export function readSecureFile(file: string, aad: string): SecureRead | null {
  if (!existsSync(file)) return null

  let contents: string
  try {
    contents = readFileSync(file, "utf8")
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return null
  }

  if (!isEnvelope(parsed)) {
    return { raw: contents, legacy: true }
  }

  try {
    return { raw: decrypt(parsed, aad), legacy: false }
  } catch {
    return null
  }
}

export function writeSecureFile(file: string, aad: string, plaintext: string) {
  const dir = dirname(file)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  const envelope = JSON.stringify(encrypt(plaintext, aad))
  const temp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`)

  writeFileSync(temp, envelope, { mode: 0o600 })
  try {
    chmodSync(temp, 0o600)
  } catch {
  }
  renameSync(temp, file)
  try {
    chmodSync(file, 0o600)
  } catch {
  }
}
