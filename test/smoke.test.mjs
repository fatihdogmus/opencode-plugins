import { test } from "node:test"
import assert from "node:assert/strict"
import { undeclaredImports } from "../scripts/release/smoke.mjs"

const manifest = {
    dependencies: { "@opencode/plugin": "2.3.2", effect: "4.0.1" },
    peerDependencies: { "@opentui/solid": ">=0.6.6", "solid-js": ">=1.9.0" },
}

test("declared, relative, node: and built-in imports are fine", () => {
    const sources = {
        "src/index.ts": `import { Plugin } from "@opencode/plugin"\nimport { Schema } from "effect"\nimport { rpc } from "./rpc"\nimport { readFile } from "node:fs/promises"\nimport path from "path"`,
        "src/tui.tsx": `import { createSignal } from "solid-js"\nconst view = () => <text fg="red">hi</text>`,
    }
    assert.deepEqual(undeclaredImports(manifest, sources), [])
})

test("an import of an undeclared package is reported with its file", () => {
    const sources = { "src/a.ts": `import { x } from "@scope/missing/deep"\nconst y = await import("left-pad")` }
    assert.deepEqual(undeclaredImports(manifest, sources), ["src/a.ts: @scope/missing", "src/a.ts: left-pad"])
})

test("JSX in a shipped .tsx file needs @opentui/solid, which OpenCode's compiler imports implicitly", () => {
    const sources = { "src/tui.tsx": `export const View = () => <box><text>hi</text></box>` }
    assert.deepEqual(undeclaredImports({ dependencies: {} }, sources), ["src/tui.tsx: @opentui/solid"])
    assert.deepEqual(undeclaredImports({ dependencies: {} }, { "src/tui.tsx": `export const n = 1 < 2` }), [])
})
