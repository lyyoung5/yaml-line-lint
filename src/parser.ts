// A line-oriented scanner for the subset of YAML this linter understands:
// block mappings, block sequences, and plain/quoted scalars. It does not
// build a full AST. It tracks just enough structure -- an indentation
// scope stack -- to catch mistakes that a generic parser glosses over,
// like a key repeated at the same level silently overwriting the first
// one.
//
// Known gap: flow-style collections ({a: 1} and [1, 2]) are not parsed.
// A line starting with "{" is treated as an unquoted key, which can
// misfire on flow mappings. Block style is the common case for config
// files, so that's what this covers first.

export interface Position {
  line: number
  column: number
}

export interface Finding {
  rule: string
  severity: "error" | "warning"
  message: string
  position: Position
  length?: number
  note?: string
  notePosition?: Position
}

interface Scope {
  column: number
  keys: Map<string, Position>
}

// Matches "key:" or "key: value" at the start of a (comment-stripped,
// indent-stripped) line. Group 1 is the raw key text, quoted or not.
const KEY_PATTERN = /^([^\s:'"#][^:]*|"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:(\s|$)/

// Splits a line at the first '#' that starts a comment: one that sits
// outside any quoted scalar and is preceded by whitespace or the start
// of the line, per the YAML spec (a bare "#" inside "http://x#y" does
// not start a comment).
export function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inSingle) {
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === "\\") {
        i++
        continue
      }
      if (ch === '"') inDouble = false
      continue
    }
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i)
    }
  }
  return line
}

function leadingWhitespaceWidth(line: string): number {
  let i = 0
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++
  return i
}

function extractKey(content: string): { key: string } | null {
  const match = KEY_PATTERN.exec(content)
  if (!match) return null
  const raw = match[1]
  const key = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw.trim()
  return { key }
}

// Walks the document looking for mapping keys that repeat at the same
// indentation level within the same parent scope. A sequence item
// ("- ") always opens a fresh scope for its inline key, since each list
// element is its own mapping and shares no keys with its siblings.
export function findDuplicateKeys(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split(/\r\n|\r|\n/)
  const stack: Scope[] = []

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1
    const withoutComment = stripComment(lines[i])
    const trimmed = withoutComment.trim()
    if (trimmed.length === 0 || trimmed === "---" || trimmed === "...") continue

    const indent = leadingWhitespaceWidth(withoutComment)
    let content = withoutComment.slice(indent)
    let column = indent + 1

    if (content.startsWith("-") && (content.length === 1 || content[1] === " ")) {
      const dashColumn = column
      while (stack.length > 0 && stack[stack.length - 1].column >= dashColumn) {
        stack.pop()
      }
      let rest = content.slice(1)
      let restColumn = column + 1
      while (rest.startsWith(" ")) {
        rest = rest.slice(1)
        restColumn++
      }
      if (rest.length === 0) continue
      const found = extractKey(rest)
      if (!found) continue
      const scope: Scope = { column: restColumn, keys: new Map() }
      scope.keys.set(found.key, { line: lineNumber, column: restColumn })
      stack.push(scope)
      continue
    }

    const found = extractKey(content)
    if (!found) continue

    while (stack.length > 0 && stack[stack.length - 1].column > column) {
      stack.pop()
    }

    let scope =
      stack.length > 0 && stack[stack.length - 1].column === column
        ? stack[stack.length - 1]
        : undefined

    if (!scope) {
      scope = { column, keys: new Map() }
      stack.push(scope)
    }

    const existing = scope.keys.get(found.key)
    if (existing) {
      findings.push({
        rule: "duplicate-key",
        severity: "error",
        message: `key "${found.key}" is already defined at line ${existing.line}`,
        position: { line: lineNumber, column },
        length: found.key.length,
        note: `first definition of "${found.key}"`,
        notePosition: existing,
      })
    } else {
      scope.keys.set(found.key, { line: lineNumber, column })
    }
  }

  return findings
}
