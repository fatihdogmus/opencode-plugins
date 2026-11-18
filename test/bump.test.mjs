import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bumpRelease, nextVersion } from "../scripts/release/bump.mjs"
import { readManifest } from "../scripts/release/packages.mjs"

const template = await readManifest("codex-guardian")

const fixture = async (version) => {
    const root = await mkdtemp(join(tmpdir(), "opencode-plugins-bump-"))
    const manifest = {
        ...template,
        name: "@fatihdogmus/opencode-example",
        version,
        repository: { ...template.repository, directory: "packages/example" },
        scripts: { preversion: 'node -e "process.exit(99)"', version: 'node -e "process.exit(99)"' },
    }
    await mkdir(join(root, "packages", "example"), { recursive: true })
    await writeFile(join(root, "packages", "example", "package.json"), JSON.stringify(manifest, null, 2) + "\n")
    return { root, manifest }
}

for (const [bump, expected] of [["patch", "1.2.4"], ["minor", "1.3.0"], ["major", "2.0.0"]]) {
    test(`${bump} changes only the package version, without hooks, commits or tags`, async () => {
        const { root, manifest } = await fixture("1.2.3")
        try {
            assert.deepEqual(await bumpRelease("example", bump, root), {
                name: "@fatihdogmus/opencode-example",
                version: expected,
                tag: `example-v${expected}`,
            })
            const changed = JSON.parse(await readFile(join(root, "packages", "example", "package.json"), "utf8"))
            assert.deepEqual(changed, { ...manifest, version: expected })
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
}

test("version bump rejects unsupported inputs before touching files", async () => {
    for (const bump of [undefined, "", "premajor", "1.2.3", "patch\nmajor"])
        await assert.rejects(bumpRelease("example", bump, "/not-a-project"), /Choose patch, minor, or major/)
    await assert.rejects(bumpRelease("../escape", "patch", "/not-a-project"), /Invalid package/)
})

test("version bump refuses a package whose release metadata is invalid", async () => {
    const { root } = await fixture("1.2.3-beta.1")
    try {
        await assert.rejects(bumpRelease("example", "patch", root))
        const unchanged = JSON.parse(await readFile(join(root, "packages", "example", "package.json"), "utf8"))
        assert.equal(unchanged.version, "1.2.3-beta.1")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("next versions follow semantic versioning", () => {
    assert.equal(nextVersion("0.3.2", "patch"), "0.3.3")
    assert.equal(nextVersion("0.3.2", "minor"), "0.4.0")
    assert.equal(nextVersion("0.3.2", "major"), "1.0.0")
})
