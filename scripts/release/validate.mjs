import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertPackageId, packageName, readManifest, REGISTRY, releaseTag, REPOSITORY } from "./packages.mjs"

export function validateRelease(manifest, id, tag) {
    assertPackageId(id)
    assert.equal(manifest.name, packageName(id), "Unexpected npm package name")
    assert.ok(!manifest.private, "Release package must not be private")
    assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Only stable versions may publish as latest")
    assert.equal(manifest.version.trim(), manifest.version, "Version must not contain whitespace")
    assert.equal(tag, releaseTag(id, manifest.version), "Release tag must match the package and its version")
    assert.equal(manifest.license, "MIT", "Packages are MIT licensed")
    assert.equal(manifest.publishConfig?.access, "public", "Scoped package must publish publicly")
    assert.equal(manifest.publishConfig?.registry, REGISTRY, "Unexpected npm registry")
    assert.equal(manifest.repository?.url, REPOSITORY, "Unexpected provenance repository")
    assert.equal(manifest.repository?.directory, `packages/${id}`, "Repository directory must point at the package")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [, , id, tag, archive, ...extra] = process.argv
    assert.equal(extra.length, 0, "Provide at most one tarball")
    const manifest = await readManifest(id)
    validateRelease(manifest, id, tag)
    if (archive) {
        const packed = JSON.parse(execFileSync("tar", ["-xOf", resolve(archive), "package/package.json"], { encoding: "utf8" }))
        validateRelease(packed, id, tag)
        assert.deepEqual(packed, manifest, "Packed manifest must match the release checkout")
    }
    console.log(`Release validated: ${manifest.name}@${manifest.version}`)
}
