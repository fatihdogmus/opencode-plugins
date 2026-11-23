// Package-specific smoke checks, run by scripts/release/smoke.mjs with the installed package's directory.
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const installed = process.argv[2]
const entry = pathToFileURL(`${installed}/dist/index.js`).href
const normalizer = pathToFileURL(`${installed}/dist/src/action-normalizer.js`).href

execFileSync(process.execPath, ["--input-type=module", "-e", `const { default: plugin } = await import(${JSON.stringify(entry)}); if (plugin.id !== "codex-guardian" || typeof plugin.setup !== "function") throw new Error("Invalid plugin entrypoint");`], { stdio: "inherit" })
execFileSync(process.execPath, ["--input-type=module", "-e", `const { normalizeAction } = await import(${JSON.stringify(normalizer)}); const action = await normalizeAction("shell", ["echo smoke"], "/workspace"); if (action.ambiguous || action.commands[0]?.executable !== "echo") throw new Error("Packaged Bash WASM parser failed");`], { stdio: "inherit" })
console.log("Guardian imports and parses Bash without TypeScript tooling or install scripts")
