import { test } from "node:test"
import assert from "node:assert/strict"
import { listPackages, packageName, readManifest, releaseTag } from "../scripts/release/packages.mjs"
import { validateRelease } from "../scripts/release/validate.mjs"

for (const id of await listPackages()) {
    const manifest = await readManifest(id)

    test(`${id}: release metadata uses the public scoped package and a matching tag`, () => {
        assert.equal(manifest.name, packageName(id))
        validateRelease(manifest, id, releaseTag(id, manifest.version))
    })

    for (const [name, override, tag] of [
        ["wrong scope", { name: `@someone-else/opencode-${id}` }],
        ["unprefixed name", { name: `@fatihdogmus/${id}` }],
        ["private package", { private: true }],
        ["restricted access", { publishConfig: { ...manifest.publishConfig, access: "restricted" } }],
        ["other registry", { publishConfig: { ...manifest.publishConfig, registry: "https://example.com/" } }],
        ["other repository", { repository: { ...manifest.repository, url: "git+https://github.com/someone-else/repo.git" } }],
        ["other package directory", { repository: { ...manifest.repository, directory: "packages/other" } }],
        ["other license", { license: "ISC" }],
        ["prerelease", { version: "0.1.0-beta.1" }, `${id}-v0.1.0-beta.1`],
        ["noncanonical version", { version: "00.1.0" }, `${id}-v00.1.0`],
        ["newline in version", { version: "0.1.0\n" }, `${id}-v0.1.0\n`],
        ["mismatched tag", {}, `${id}-v99.0.0`],
        ["tag of another package", {}, `other-v${manifest.version}`],
        ["unprefixed tag", {}, `v${manifest.version}`],
        ["missing tag", {}, null],
    ])
        test(`${id}: release rejects ${name}`, () => {
            const releaseTagValue = tag === null ? undefined : (tag ?? releaseTag(id, manifest.version))
            assert.throws(() => validateRelease({ ...manifest, ...override }, id, releaseTagValue))
        })
}

test("release rejects package ids that could escape packages/", () => {
    for (const id of ["../x", "a/b", "", "Upper", undefined]) assert.throws(() => validateRelease({}, id, "x"))
})
