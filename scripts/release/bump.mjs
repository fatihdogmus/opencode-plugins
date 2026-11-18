import assert from "node:assert/strict"
import { appendFile, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertPackageId, BUMPS, packageDirectory, releaseTag, ROOT } from "./packages.mjs"
import { validateRelease } from "./validate.mjs"

export function nextVersion(version, bump) {
    const [major, minor, patch] = version.split(".").map(Number)
    if (bump === "major") return `${major + 1}.0.0`
    if (bump === "minor") return `${major}.${minor + 1}.0`
    return `${major}.${minor}.${patch + 1}`
}

/**
 * Bumps one package's version in its package.json and nothing else. pnpm-lock.yaml does not record workspace
 * versions, so the lockfile stays as it is.
 */
export async function bumpRelease(id, bump, root = ROOT) {
    assert.ok(BUMPS.includes(bump), "Choose patch, minor, or major")
    assertPackageId(id)
    const manifestFile = join(packageDirectory(id, root), "package.json")
    const raw = await readFile(manifestFile, "utf8")
    const before = JSON.parse(raw)
    validateRelease(before, id, releaseTag(id, before.version))

    const version = nextVersion(before.version, bump)
    const after = { ...before, version }
    await writeFile(manifestFile, JSON.stringify(after, null, 2) + "\n")

    const written = JSON.parse(await readFile(manifestFile, "utf8"))
    const tag = releaseTag(id, version)
    validateRelease(written, id, tag)
    assert.deepEqual(written, { ...before, version }, "Bump may only change the manifest version")
    return { name: written.name, version, tag }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await bumpRelease(process.argv[2], process.argv[3])
    if (process.env.GITHUB_OUTPUT)
        await appendFile(process.env.GITHUB_OUTPUT, `name=${result.name}\nversion=${result.version}\ntag=${result.tag}\n`)
    console.log(`Prepared ${result.name} ${result.tag}; commit only after release checks pass`)
}
