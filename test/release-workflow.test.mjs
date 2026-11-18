import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { listPackages } from "../scripts/release/packages.mjs"

const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")
const build = await readFile(new URL("../.github/workflows/build.yml", import.meta.url), "utf8")

const choices = (input) => {
    const block = workflow.match(new RegExp(`^      ${input}:\\n(?:        .*\\n)+`, "m"))?.[0] ?? ""
    return [...block.matchAll(/^          - (.+)$/gm)].map((match) => match[1])
}

test("one manual release publishes npm and GitHub without drafts or a second workflow", () => {
    assert.match(workflow, /^name: Release$/m)
    assert.match(workflow, /workflow_dispatch:/)
    assert.match(workflow, /default: patch/)
    assert.deepEqual(choices("bump"), ["patch", "minor", "major"])
    assert.doesNotMatch(workflow, /--draft|types: \[published\]/)
    assert.match(workflow, /id-token: write/)
    assert.match(workflow, /npm publish "\$TARBALL" .*--provenance/)
    assert.match(workflow, /gh release create .*--verify-tag/)
})

test("the release workflow offers exactly the packages in packages/", async () => {
    assert.deepEqual(choices("package"), await listPackages())
})

test("release checks everything first, publishes to npm, and only then pushes and creates the GitHub release", () => {
    const steps = [
        "Require the current main commit",
        "Require npm with trusted publishing support",
        "Bump the package version",
        "Require a new release tag",
        "Require an unpublished npm version",
        "Check the repository release tooling",
        "Check the package",
        "Pack and smoke-test the package",
        "Validate tested package",
        "Save tested package for recovery",
        "Commit and tag the version locally",
        "Require main to be unchanged before publishing",
        "Publish tested tarball to npm",
        "Push the version commit and tag",
        "Publish GitHub release",
    ].map((step) => workflow.indexOf(`name: ${step}`) >= 0 ? workflow.indexOf(`name: ${step}`) : workflow.indexOf(step))
    assert.ok(steps.every((position, index) => position >= 0 && (index === 0 || position > steps[index - 1])))
    assert.match(workflow, /git push --atomic/)
    assert.doesNotMatch(workflow, /git push[^\n]*--force/)
})

test("npm publishing uses trusted publishing, not a stored npm token", () => {
    assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./)
    assert.match(workflow, /^      id-token: write$/m)
    assert.match(workflow, /^    environment: npm$/m)
})

test("nothing is pushed until npm publishing has succeeded", () => {
    const publish = workflow.indexOf("npm publish ")
    const pushes = [...workflow.matchAll(/git push/g)].map((match) => match.index)
    assert.ok(publish > 0 && pushes.length > 0)
    assert.ok(pushes.every((position) => position > publish), "Every git push must come after npm publish")
})

const shellLines = (source) => {
    const lines = []
    let blockIndent = -1
    for (const line of source.split("\n")) {
        const indent = line.length - line.trimStart().length
        if (blockIndent >= 0 && (line.trim() === "" || indent > blockIndent)) {
            lines.push(line)
            continue
        }
        blockIndent = -1
        const run = line.match(/^(\s*)(?:- )?run: (.*)$/)
        if (!run) continue
        if (run[2].trim() === "|") blockIndent = run[1].length
        else lines.push(line)
    }
    return lines
}

test("workflow inputs reach shell steps only through environment variables", () => {
    const lines = shellLines(workflow)
    assert.ok(lines.some((line) => line.includes("bump.mjs")), "Found the run scripts")
    for (const line of lines) assert.doesNotMatch(line, /\$\{\{/, `Expression inside a shell command: ${line.trim()}`)
})

test("the release commit may only change the released package's manifest", () => {
    assert.match(workflow, /git diff --exit-code -- \. ":!packages\/\$PACKAGE\/package\.json"/)
    assert.match(workflow, /git add "packages\/\$PACKAGE\/package\.json"/)
})

test("pushes and pull requests build every package without publishing", () => {
    assert.match(build, /pull_request:/)
    assert.match(build, /pnpm check/)
    assert.match(build, /pnpm package/)
    assert.doesNotMatch(build, /npm publish|NPM_TOKEN|id-token/)
})
