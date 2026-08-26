import { exec } from "node:child_process"

export function openUrl(url: string) {
  const platform = process.platform

  if (platform === "win32") {
    exec(`start "" "${url}"`)
    return
  }

  if (platform === "darwin") {
    exec(`open "${url}"`)
    return
  }

  exec(`xdg-open "${url}"`)
}
