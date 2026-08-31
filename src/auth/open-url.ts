import { spawn } from "node:child_process"

export function openUrl(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("La URL de autorización no es válida")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`No se abre una URL con esquema "${parsed.protocol}"`)
  }

  const target = parsed.toString()
  const detached = { stdio: "ignore" as const, detached: true }

  const child =
    process.platform === "win32"
      ? // `start` es interno de cmd; el "" ocupa el hueco del título para que
        spawn(process.env.ComSpec ?? "cmd.exe", ["/c", "start", "", target], detached)
      : process.platform === "darwin"
        ? spawn("open", [target], detached)
        : spawn("xdg-open", [target], detached)

  child.on("error", () => {
  })
  child.unref()
}
