#!/usr/bin/env -S node --experimental-strip-types
import { readFileSync } from "node:fs"
import { lint } from "./linter.ts"
import type { Finding } from "./linter.ts"

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

function lintFile(filename: string): { errors: number; warnings: number } {
  let source: string
  try {
    source = readFileSync(filename, "utf8")
  } catch (err) {
    process.stderr.write(`${filename}: cannot read file (${(err as Error).message})\n`)
    return { errors: 1, warnings: 0 }
  }

  const lines = source.split(/\r\n|\r|\n/)
  const findings = lint(source)
  let errors = 0
  let warnings = 0

  for (const finding of findings) {
    process.stdout.write(renderFinding(filename, lines, finding) + "\n\n")
    if (finding.severity === "error") errors++
    else warnings++
  }

  return { errors, warnings }
}

function main(argv: string[]): number {
  if (argv.length === 0) {
    process.stderr.write("usage: yamlint <file...>\n")
    return 2
  }

  let totalErrors = 0
  let totalWarnings = 0

  for (const filename of argv) {
    const { errors, warnings } = lintFile(filename)
    totalErrors += errors
    totalWarnings += warnings
  }

  process.stdout.write(`${totalErrors} error(s), ${totalWarnings} warning(s)\n`)
  return totalErrors > 0 ? 1 : 0
}

process.exit(main(process.argv.slice(2)))
