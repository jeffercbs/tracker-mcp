import { createServer } from "node:http"
import { randomBytes } from "node:crypto"

import { webAppUrl } from "../config/web-env.js"
import { openUrl } from "./open-url.js"
import { saveSession } from "./session-store.js"

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family: sans-serif; text-align:center; padding-top: 4rem;">
<h2>my-tracker-mcp autorizado</h2>
<p>Ya podés cerrar esta pestaña y volver a tu cliente MCP.</p>
</body></html>`

function errorHtml(message: string) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family: sans-serif; text-align:center; padding-top: 4rem;">
<h2>No se pudo autorizar my-tracker-mcp</h2>
<p>${message}</p>
</body></html>`
}

async function exchangeCode(code: string) {
  const response = await fetch(`${webAppUrl}/api/mcp/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  })

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null

  if (!response.ok || !data) {
    const message = typeof data?.error === "string" ? data.error : `El servidor respondió ${response.status}`
    throw new Error(message)
  }

  return data as {
    accessToken: string
    refreshToken: string
    expiresAt: number | null
    userId: string
    email: string | null
  }
}

export interface LoginResult {
  userId: string
  email: string
  authorizeUrl: string
}

export function performBrowserLogin(options?: { onAuthorizeUrl?: (url: string) => void }): Promise<LoginResult> {
  const state = randomBytes(16).toString("hex")

  return new Promise<LoginResult>((resolve, reject) => {
    let settled = false
    let timeoutHandle: NodeJS.Timeout
    let authorizeUrl = ""

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")

      if (url.pathname !== "/callback") {
        res.writeHead(404)
        res.end()
        return
      }

      const receivedState = url.searchParams.get("state")
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

      if (receivedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.write(errorHtml("El parámetro state no coincide."))
        finish(new Error("El state de la autorización no coincide"))
        return
      }

      if (errorParam) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.write(errorHtml(`La autorización fue rechazada (${errorParam}).`))
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
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          res.write(errorHtml(String(err?.message ?? err)))
          finish(err instanceof Error ? err : new Error(String(err)))
        })
    })

    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : null
      if (!port) {
        settled = true
        reject(new Error("No se pudo abrir un puerto local para el login"))
        return
      }

      const authorizeUrlObj = new URL("/mcp/authorize", webAppUrl)
      authorizeUrlObj.searchParams.set("state", state)
      authorizeUrlObj.searchParams.set("port", String(port))
      authorizeUrl = authorizeUrlObj.toString()

      openUrl(authorizeUrl)

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
