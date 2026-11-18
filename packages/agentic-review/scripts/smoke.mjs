// Package-specific smoke checks, run by scripts/release/smoke.mjs with the installed package's directory.
import { pathToFileURL } from "node:url"

const { default: plugin, AgenticReviewPlugin } = await import(pathToFileURL(`${process.argv[2]}/dist/index.js`).href)
if (typeof plugin !== "function" || plugin !== AgenticReviewPlugin) throw new Error("Invalid plugin entrypoint")
console.log("Agentic Review plugin imports without TypeScript tooling or install scripts")
