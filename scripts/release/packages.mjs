import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const SCOPE = "@fatihdogmus"
export const REGISTRY = "https://registry.npmjs.org/"
export const REPOSITORY = "git+https://github.com/fatihdogmus/opencode-plugins.git"
export const ROOT = fileURLToPath(new URL("../../", import.meta.url))
export const BUMPS = ["patch", "minor", "major"]

/** Every publishable plugin lives in packages/<id> and publishes as @fatihdogmus/opencode-<id>. */
export const packageName = (id) => `${SCOPE}/opencode-${id}`
export const releaseTag = (id, version) => `${id}-v${version}`
export const packageDirectory = (id, root = ROOT) => join(root, "packages", id)

export async function listPackages(root = ROOT) {
    const entries = await readdir(join(root, "packages"), { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

export async function readManifest(id, root = ROOT) {
    return JSON.parse(await readFile(join(packageDirectory(id, root), "package.json"), "utf8"))
}

export function assertPackageId(id) {
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid package: ${JSON.stringify(id)}`)
}
