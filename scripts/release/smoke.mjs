import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { builtinModules } from "node:module"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { packageDirectory, releaseTag } from "./packages.mjs"
import { validateRelease } from "./validate.mjs"

const ALWAYS = ["package.json", "README.md", "LICENSE"]

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)["']([^"']+)["']/gm

const packageOf = (specifier) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/")

/**
 * Shipped source files run in the user's install, where only dependencies and peerDependencies exist. OpenCode compiles a
 * TUI part's JSX into imports from @opentui/solid, so a shipped .tsx file needs it declared too.
 */
export function undeclaredImports(manifest, sources) {
    const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])
    const missing = new Set()
    for (const [file, text] of Object.entries(sources)) {
        const needed = [...text.matchAll(IMPORT)].map((match) => match[1])
        if (file.endsWith("x") && /<[a-z][\w-]*[\s>/]/.test(text)) needed.push("@opentui/solid")
        for (const specifier of needed) {
            if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) continue
            if (builtinModules.includes(specifier)) continue
            if (!declared.has(packageOf(specifier))) missing.add(`${file}: ${packageOf(specifier)}`)
        }
    }
    return [...missing]
}

const exportTargets = (exports) => {
    if (typeof exports === "string") return [exports]
    if (!exports || typeof exports !== "object") return []
    return Object.values(exports).flatMap(exportTargets)
}

/** Installs the packed tarball like a user would and checks its contents; packages can add checks in scripts/smoke.mjs. */
export async function smoke(id, tarball) {
    const archive = resolve(tarball)
    const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
        .trim()
        .split("\n")
        .map((file) => file.replace(/^package\//, ""))
    const manifest = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }))
    validateRelease(manifest, id, releaseTag(id, manifest.version))

    for (const file of ALWAYS) assert.ok(files.includes(file), `Package must include ${file}`)
    for (const target of exportTargets(manifest.exports))
        assert.ok(files.includes(target.replace(/^\.\//, "")), `Export target missing from the package: ${target}`)
    const allowed = (manifest.files ?? []).map((entry) => entry.replace(/^\.\//, "").replace(/\/$/, ""))
    for (const file of files)
        assert.ok(
            ALWAYS.includes(file) || allowed.some((entry) => file === entry || file.startsWith(`${entry}/`)),
            `Unexpected file in the package: ${file}`,
        )

    const shipped = Object.fromEntries(
        files
            .filter((file) => SOURCE.test(file) && !file.startsWith("dist/"))
            .map((file) => [file, execFileSync("tar", ["-xOf", archive, `package/${file}`], { encoding: "utf8" })]),
    )
    const undeclared = undeclaredImports(manifest, shipped)
    assert.deepEqual(undeclared, [], `Shipped sources import packages the manifest doesn't declare:\n${undeclared.join("\n")}`)

    const directory = await mkdtemp(join(tmpdir(), `${id}-smoke-`))
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"))
    try {
        await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }))
        execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], { cwd: directory, env, stdio: "inherit" })
        const installed = join(directory, "node_modules", manifest.name)
        assert.deepEqual(JSON.parse(await readFile(join(installed, "package.json"), "utf8")), manifest, "Installed manifest must match")
        const hook = join(packageDirectory(id), "scripts", "smoke.mjs")
        if (existsSync(hook)) execFileSync(process.execPath, [hook, installed], { cwd: directory, stdio: "inherit" })
        console.log(`Smoke test passed: ${manifest.name}@${manifest.version} installs without build tooling or install scripts`)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [, , id, tarball, ...extra] = process.argv
    assert.ok(id && tarball && extra.length === 0, "Usage: smoke.mjs <package> <tarball>")
    await smoke(id, tarball)
}
