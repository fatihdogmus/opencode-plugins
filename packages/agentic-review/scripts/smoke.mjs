// Package-specific smoke checks, run by scripts/release/smoke.mjs with the installed package's directory.
import { pathToFileURL } from "node:url"

const { default: plugin } = await import(pathToFileURL(`${process.argv[2]}/dist/index.js`).href)
if (plugin?.id !== "agentic-review" || typeof plugin.setup !== "function") throw new Error("Invalid V2 plugin entrypoint")
console.log("Agentic Review plugin imports without TypeScript tooling or install scripts")
