import { createServer } from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"

import { webAppUrl } from "../config/web-env.js"
import { openUrl } from "./open-url.js"
import { saveSession } from "./session-store.js"

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const ALLOWED_CALLBACK_HOSTS = new Set(["127.0.0.1", "localhost"])

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family: sans-serif; text-align:center; padding-top: 4rem;">
<h2>my-tracker-mcp autorizado</h2>
<p>Ya podés cerrar esta pestaña y volver a tu cliente MCP.</p>
</body></html>`

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}

function errorHtml(message: string) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family: sans-serif; text-align:center; padding-top: 4rem;">
<h2>No se pudo autorizar my-tracker-mcp</h2>
<p>${escapeHtml(message)}</p>
</body></html>`
}

function statesMatch(expected: string, received: string | null): boolean {
  if (!received) return false
  const a = Buffer.from(expected, "utf8")
  const b = Buffer.from(received, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

interface ExchangedSession {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  userId: string
  email: string | null
}

function parseExchangeResponse(payload: unknown): ExchangedSession {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("El servidor devolvió una respuesta inesperada al canjear el código")
  }
  const data = payload as Record<string, unknown>
  const { accessToken, refreshToken, userId } = data

  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    typeof userId !== "string" ||
    userId.length === 0
  ) {
    throw new Error("La respuesta de autorización no traía una sesión completa")
  }

  return {
    accessToken,
    refreshToken,
    userId,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
    email: typeof data.email === "string" ? data.email : null,
  }
}

async function exchangeCode(code: string): Promise<ExchangedSession> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const response = await fetch(`${webAppUrl}/api/mcp/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    })

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null

    if (!response.ok) {
      const message =
        typeof data?.error === "string" ? data.error : `El servidor respondió ${response.status}`
      throw new Error(message)
    }

    return parseExchangeResponse(data)
  } finally {
    clearTimeout(timeout)
  }
}

export interface LoginResult {
  userId: string
  email: string
  authorizeUrl: string
}

export function performBrowserLogin(options?: {
  onAuthorizeUrl?: (url: string) => void
}): Promise<LoginResult> {
  const state = randomBytes(32).toString("hex")

  return new Promise<LoginResult>((resolve, reject) => {
    let settled = false
    let handled = false
    let timeoutHandle: NodeJS.Timeout
    let authorizeUrl = ""

    const server = createServer((req, res) => {
      const hostHeader = (req.headers.host ?? "").split(":")[0]
      if (!ALLOWED_CALLBACK_HOSTS.has(hostHeader)) {
        res.writeHead(403)
        res.end()
        return
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1")

      if (req.method !== "GET" || url.pathname !== "/callback") {
        res.writeHead(404)
        res.end()
        return
      }

      if (handled) {
        res.writeHead(410)
        res.end()
        return
      }
      handled = true

      const errorParam = url.searchParams.get("error")
      const code = url.searchParams.get("code")

      const finish = (err?: Error, result?: LoginResult) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle)
        res.end()
        server.close()
        if (err) reject(err)
        else resolve(result!)
      }

      if (!statesMatch(state, url.searchParams.get("state"))) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.write(errorHtml("El parámetro state no coincide."))
        finish(new Error("El state de la autorización no coincide"))
        return
      }

      if (errorParam) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.write(errorHtml("La autorización fue rechazada."))
        finish(new Error(`Autorización rechazada: ${errorParam}`))
        return
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.write(errorHtml("No se recibió un código de autorización."))
        finish(new Error("No se recibió un código de autorización"))
        return
      }

      exchangeCode(code)
        .then((session) => {
          saveSession({
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresAt: session.expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
            userId: session.userId,
            email: session.email ?? "",
          })
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          res.write(SUCCESS_HTML)
          finish(undefined, {
            userId: session.userId,
            email: session.email ?? session.userId,
            authorizeUrl,
          })
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          res.write(errorHtml(message))
          finish(err instanceof Error ? err : new Error(message))
        })
    })

    server.on("error", (err) => {
      if (settled) return
      settled = true
      reject(err)
    })

    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : null
      if (!port) {
        settled = true
        server.close()
        reject(new Error("No se pudo abrir un puerto local para el login"))
        return
      }

      const authorizeUrlObj = new URL("/mcp/authorize", webAppUrl)
      authorizeUrlObj.searchParams.set("state", state)
      authorizeUrlObj.searchParams.set("port", String(port))
      authorizeUrl = authorizeUrlObj.toString()

      try {
        openUrl(authorizeUrl)
      } catch {
      }

      options?.onAuthorizeUrl?.(authorizeUrl)

      timeoutHandle = setTimeout(() => {
        if (settled) return
        settled = true
        server.close()
        reject(new Error("Se agotó el tiempo de espera para autorizar (5 minutos)"))
      }, LOGIN_TIMEOUT_MS)
    })
  })
}
