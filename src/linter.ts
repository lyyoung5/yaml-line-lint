import { findDuplicateKeys } from "./parser.ts"
import type { Finding } from "./parser.ts"

export type { Finding, Position } from "./parser.ts"

function checkTabs(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split(/\r\n|\r|\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const tabIndex = line.indexOf("\t")
    if (tabIndex === -1) continue

    let leading = 0
    while (leading < line.length && (line[leading] === " " || line[leading] === "\t")) leading++
    if (tabIndex >= leading) continue // tab appears after content, not in indentation

    findings.push({
      rule: "no-tabs",
      severity: "error",
      message: "YAML forbids tabs in indentation; use spaces",
      position: { line: i + 1, column: tabIndex + 1 },
      length: 1,
    })
  }

  return findings
}

function checkTrailingWhitespace(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split(/\r\n|\r|\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.replace(/[ \t]+$/, "")
    if (trimmed.length === line.length || trimmed.length === 0) continue

    findings.push({
      rule: "trailing-whitespace",
      severity: "warning",
      message: "trailing whitespace",
      position: { line: i + 1, column: trimmed.length + 1 },
      length: line.length - trimmed.length,
    })
  }

  return findings
}

export function lint(text: string): Finding[] {
  const findings = [...checkTabs(text), ...checkTrailingWhitespace(text), ...findDuplicateKeys(text)]
  findings.sort((a, b) => a.position.line - b.position.line || a.position.column - b.position.column)
  return findings
}
