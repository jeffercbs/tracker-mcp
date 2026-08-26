import { performBrowserLogin } from "../src/auth/auth-flow.js"

async function main() {
  console.log("Abriendo el navegador para autorizar my-tracker-mcp...")

  const result = await performBrowserLogin({
    onAuthorizeUrl: (url) => console.log(`Si no se abre solo, entrá a: ${url}`),
  })

  console.log(`Sesión guardada para ${result.email}. Ya podés usar el servidor MCP.`)
}

main().catch((err) => {
  console.error(`Login falló: ${err.message ?? err}`)
  process.exit(1)
})
