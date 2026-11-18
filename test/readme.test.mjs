import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { listPackages, packageDirectory, readManifest } from "../scripts/release/packages.mjs"

/** The text of a `## <title>` section, up to the next `## ` heading. */
const section = (markdown, title) => {
    const start = markdown.search(new RegExp(`^## ${title}$`, "m"))
    if (start < 0) return undefined
    const rest = markdown.slice(start).split("\n").slice(1).join("\n")
    const end = rest.search(/^## /m)
    return end < 0 ? rest : rest.slice(0, end)
}

for (const id of await listPackages()) {
    test(`${id}: README has a "For agents" section that installs, verifies and removes the plugin`, async () => {
        const { name } = await readManifest(id)
        const readme = await readFile(join(packageDirectory(id), "README.md"), "utf8").catch(() => undefined)
        assert.ok(readme, `packages/${id}/README.md is missing`)
        const agents = section(readme, "For agents")
        assert.ok(agents, `packages/${id}/README.md needs a "## For agents" section`)
        assert.match(agents, new RegExp(`opencode plugin add ${name.replace("/", "\\/")}\\b`), "Install with opencode plugin add")
        assert.match(agents, /opencode plugin list/, "Explain how to verify the install")
        assert.match(agents, new RegExp(`opencode plugin remove ${name.replace("/", "\\/")}\\b`), "Explain how to remove it")
    })
}
