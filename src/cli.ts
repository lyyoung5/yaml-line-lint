#!/usr/bin/env -S node --experimental-strip-types
import { readFileSync } from "node:fs"
import { lint } from "./linter.ts"
import type { Finding } from "./linter.ts"
import { defaultConfig, parseConfig } from "./config.ts"
import type { Config } from "./config.ts"

type Format = "text" | "json"

const DEFAULT_CONFIG_FILENAME = ".yamllint.json"

// Loads `explicitPath` if given, erroring out if it can't be read.
// Otherwise looks for the default config filename in the current
// directory and falls back to built-in defaults if that isn't there
// either -- a missing default config is normal, not an error.
function loadConfig(explicitPath: string | undefined): Config {
  const path = explicitPath ?? DEFAULT_CONFIG_FILENAME
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (err) {
    if (explicitPath) {
      throw new Error(`cannot read config file "${path}": ${(err as Error).message}`)
    }
    return defaultConfig()
  }
  return parseConfig(text, path)
}

interface FileResult {
  file: string
  findings: Finding[]
  source?: string
  readError?: string
}

function renderFinding(filename: string, lines: string[], finding: Finding): string {
  const sourceLine = lines[finding.position.line - 1] ?? ""
  const gutter = String(finding.position.line)
  const pad = " ".repeat(gutter.length)
  const caretLine = " ".repeat(finding.position.column - 1) + "^".repeat(Math.max(1, finding.length ?? 1))

  const parts = [
    `${filename}:${finding.position.line}:${finding.position.column}: ${finding.severity} [${finding.rule}] ${finding.message}`,
    `${pad} |`,
    `${gutter} | ${sourceLine}`,
    `${pad} | ${caretLine}`,
  ]

  if (finding.note && finding.notePosition) {
    const noteLine = lines[finding.notePosition.line - 1] ?? ""
    const noteGutter = String(finding.notePosition.line)
    const notePad = " ".repeat(noteGutter.length)
    parts.push(
      ` = note: ${finding.note}, at ${filename}:${finding.notePosition.line}:${finding.notePosition.column}`,
      `${notePad} |`,
      `${noteGutter} | ${noteLine}`,
      `${notePad} |`,
    )
  }

  return parts.join("\n")
}

function lintFile(filename: string, config: Config): FileResult {
  let source: string
  try {
    source = readFileSync(filename, "utf8")
  } catch (err) {
    return { file: filename, findings: [], readError: (err as Error).message }
  }
  return { file: filename, findings: lint(source, config), source }
}

function countSeverities(results: FileResult[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const result of results) {
    if (result.readError) {
      errors++
      continue
    }
    for (const finding of result.findings) {
      if (finding.severity === "error") errors++
      else warnings++
    }
  }
  return { errors, warnings }
}

function printText(results: FileResult[]): void {
  for (const result of results) {
    if (result.readError) {
      process.stderr.write(`${result.file}: cannot read file (${result.readError})\n`)
      continue
    }
    const lines = (result.source ?? "").split(/\r\n|\r|\n/)
    for (const finding of result.findings) {
      process.stdout.write(renderFinding(result.file, lines, finding) + "\n\n")
    }
  }

  const { errors, warnings } = countSeverities(results)
  process.stdout.write(`${errors} error(s), ${warnings} warning(s)\n`)
}

function printJson(results: FileResult[]): void {
  const { errors, warnings } = countSeverities(results)
  const files = results.map((result) =>
    result.readError
      ? { file: result.file, error: result.readError }
      : { file: result.file, findings: result.findings },
  )
  process.stdout.write(JSON.stringify({ files, errors, warnings }, null, 2) + "\n")
}

function parseArgs(argv: string[]): { format: Format; configPath: string | undefined; files: string[] } | null {
  let format: Format = "text"
  let configPath: string | undefined
  const files: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === "--format" || arg.startsWith("--format=")) {
      const value = arg === "--format" ? argv[++i] : arg.slice("--format=".length)
      if (value !== "text" && value !== "json") {
        process.stderr.write(`unknown format "${value ?? ""}", expected "text" or "json"\n`)
        return null
      }
      format = value
      continue
    }

    if (arg === "--config" || arg.startsWith("--config=")) {
      configPath = arg === "--config" ? argv[++i] : arg.slice("--config=".length)
      if (configPath === undefined) {
        process.stderr.write("--config requires a path\n")
        return null
      }
      continue
    }

    files.push(arg)
  }

  return { format, configPath, files }
}

function main(argv: string[]): number {
  const parsed = parseArgs(argv)
  if (!parsed) return 2

  const { format, configPath, files } = parsed
  if (files.length === 0) {
    process.stderr.write("usage: yamlint [--format text|json] [--config <path>] <file...>\n")
    return 2
  }

  let config: Config
  try {
    config = loadConfig(configPath)
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`)
    return 2
  }

  const results = files.map((file) => lintFile(file, config))
  if (format === "json") {
    printJson(results)
  } else {
    printText(results)
  }

  const { errors } = countSeverities(results)
  return errors > 0 ? 1 : 0
}

process.exit(main(process.argv.slice(2)))
