import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { appendFile, mkdir, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertPackageId, listPackages, readManifest, ROOT } from "./packages.mjs"
import { smoke } from "./smoke.mjs"

const ARTIFACTS = join(ROOT, "artifacts")

/** Packs one workspace into artifacts/ (run its build first) and returns the tarball's path. */
export async function pack(id) {
    assertPackageId(id)
    const manifest = await readManifest(id)
    await mkdir(ARTIFACTS, { recursive: true })
    const before = new Set(await readdir(ARTIFACTS))
    execFileSync("pnpm", ["--filter", `./packages/${id}`, "pack", "--pack-destination", ARTIFACTS], { cwd: ROOT, stdio: "pipe" })
    const created = (await readdir(ARTIFACTS)).filter((file) => file.endsWith(".tgz") && !before.has(file))
    const expected = `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`
    assert.deepEqual(created, [expected], `Expected pnpm pack to create ${expected}`)
    return join(ARTIFACTS, expected)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const ids = process.argv.slice(2)
    for (const id of ids.length ? ids : await listPackages()) {
        const tarball = await pack(id)
        await smoke(id, tarball)
        if (process.env.GITHUB_OUTPUT && ids.length === 1) await appendFile(process.env.GITHUB_OUTPUT, `tarball=${tarball}\n`)
        console.log(`Packed ${tarball}`)
    }
}
