// A line-oriented scanner for the subset of YAML this linter understands:
// block mappings, block sequences, flow mappings/sequences, and
// plain/quoted scalars. It does not build a full AST. For block content
// it tracks an indentation scope stack; for flow content (`{...}` /
// `[...]`) it tracks a bracket-and-key stack instead, since flow entries
// are delimited by commas and brackets rather than by column. That's
// enough structure to catch a key repeated at the same nesting level,
// whether the repeat happens in block or flow style, and a flow
// collection is allowed to span several physical lines.
//
// Known gaps: the flow-sequence shorthand for single-pair mappings
// (`[a: 1, b: 2]`, equivalent to `[{a: 1}, {b: 2}]`) isn't recognized --
// its entries are treated as plain values, not keys. Anchors, aliases,
// and merge keys aren't handled.

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

interface FlowFrame {
  bracket: "{" | "["
  keys: Map<string, Position>
}

interface FlowState {
  stack: FlowFrame[]
  expectingKey: boolean
  // Set when a quoted scalar is left open at the end of a line (a
  // literal newline inside a multi-line quoted string). Scanning
  // resumes in quote-skipping mode on the next line, but a key check
  // isn't attempted for a quote that crosses a line boundary -- that
  // combination is rare enough not to be worth the extra state.
  inSingleQuote: boolean
  inDoubleQuote: boolean
}

function newFlowState(): FlowState {
  return { stack: [], expectingKey: false, inSingleQuote: false, inDoubleQuote: false }
}

// Matches "key:" or "key: value" at the start of a (comment-stripped,
// indent-stripped) line. Group 1 is the raw key text, quoted or not.
const KEY_PATTERN = /^([^\s:'"#][^:]*|"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:(\s|$)/

// Characters that end a bare (unquoted) token inside a flow collection.
const FLOW_TOKEN_BOUNDARY = /[,:{}[\]'"]/

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

function extractKey(content: string): { key: string; matchEnd: number } | null {
  const match = KEY_PATTERN.exec(content)
  if (!match) return null
  const raw = match[1]
  const key = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw.trim()
  return { key, matchEnd: match[0].length }
}

// Scans flow-style content (`{...}` / `[...]`) starting at `text[startIndex]`,
// picking up mid-structure if `state` already has frames open from a
// previous line. Duplicate keys are tracked per `{...}` frame; `[...]`
// entries aren't checked since sequence items don't carry keys. Returns
// the index just past the point where every open frame closes, or null
// if the line ran out while frames were still open -- the caller then
// carries `state` into the next line.
function scanFlow(
  text: string,
  startIndex: number,
  lineNumber: number,
  state: FlowState,
): { findings: Finding[]; endIndex: number | null } {
  const findings: Finding[] = []
  let i = startIndex

  const topIsMapping = () =>
    state.stack.length > 0 && state.stack[state.stack.length - 1].bracket === "{"

  const recordKey = (key: string, columnIndex: number) => {
    const frame = state.stack[state.stack.length - 1]
    const position: Position = { line: lineNumber, column: columnIndex + 1 }
    const existing = frame.keys.get(key)
    if (existing) {
      findings.push({
        rule: "duplicate-key",
        severity: "error",
        message: `key "${key}" is already defined at line ${existing.line}`,
        position,
        length: key.length,
        note: `first definition of "${key}"`,
        notePosition: existing,
      })
    } else {
      frame.keys.set(key, position)
    }
  }

  while (i < text.length) {
    const ch = text[i]

    if (state.inSingleQuote) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          i += 2
          continue
        }
        state.inSingleQuote = false
        state.expectingKey = false
      }
      i++
      continue
    }
    if (state.inDoubleQuote) {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === '"') {
        state.inDoubleQuote = false
        state.expectingKey = false
      }
      i++
      continue
    }

    if (ch === " " || ch === "\t") {
      i++
      continue
    }

    if (ch === "{" || ch === "[") {
      state.stack.push({ bracket: ch, keys: new Map() })
      state.expectingKey = ch === "{"
      i++
      continue
    }

    if (ch === "}" || ch === "]") {
      state.stack.pop()
      state.expectingKey = false
      i++
      if (state.stack.length === 0) return { findings, endIndex: i }
      continue
    }

    if (ch === ",") {
      state.expectingKey = topIsMapping()
      i++
      continue
    }

    if (ch === "'" || ch === '"') {
      const quote = ch
      const quoteStart = i
      let j = i + 1
      let value = ""
      let closed = false
      while (j < text.length) {
        const c = text[j]
        if (quote === "'") {
          if (c === "'") {
            if (text[j + 1] === "'") {
              value += "'"
              j += 2
              continue
            }
            j++
            closed = true
            break
          }
          value += c
          j++
        } else {
          if (c === "\\") {
            value += text.slice(j, j + 2)
            j += 2
            continue
          }
          if (c === '"') {
            j++
            closed = true
            break
          }
          value += c
          j++
        }
      }
      if (!closed) {
        if (quote === "'") state.inSingleQuote = true
        else state.inDoubleQuote = true
        return { findings, endIndex: null }
      }
      let k = j
      while (k < text.length && (text[k] === " " || text[k] === "\t")) k++
      if (state.expectingKey && topIsMapping() && text[k] === ":") {
        recordKey(value, quoteStart)
        i = k + 1
      } else {
        i = j
      }
      state.expectingKey = false
      continue
    }

    const tokenStart = i
    let j = i
    while (j < text.length && !FLOW_TOKEN_BOUNDARY.test(text[j])) j++
    const token = text.slice(tokenStart, j).trim()
    let k = j
    while (k < text.length && (text[k] === " " || text[k] === "\t")) k++
    if (state.expectingKey && topIsMapping() && token.length > 0 && text[k] === ":") {
      recordKey(token, tokenStart)
      i = k + 1
    } else {
      i = j > tokenStart ? j : j + 1
    }
    state.expectingKey = false
  }

  return { findings, endIndex: null }
}

// If the text at `fromIndex` (after skipping spaces/tabs) opens a flow
// collection, scans it and returns the resulting state -- non-null only
// when the collection is still open at the end of the line, so the
// caller knows to resume it on the next one.
function maybeStartFlowValue(
  text: string,
  fromIndex: number,
  lineNumber: number,
  findings: Finding[],
): FlowState | null {
  let idx = fromIndex
  while (idx < text.length && (text[idx] === " " || text[idx] === "\t")) idx++
  if (text[idx] !== "{" && text[idx] !== "[") return null

  const flow = newFlowState()
  const result = scanFlow(text, idx, lineNumber, flow)
  findings.push(...result.findings)
  return result.endIndex === null ? flow : null
}

// Walks the document looking for mapping keys that repeat at the same
// indentation level within the same parent scope, in both block and
// flow style. A sequence item ("- ") always opens a fresh scope for its
// inline key, since each list element is its own mapping and shares no
// keys with its siblings.
export function findDuplicateKeys(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split(/\r\n|\r|\n/)
  const stack: Scope[] = []
  let flow: FlowState | null = null

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1
    const withoutComment = stripComment(lines[i])

    if (flow) {
      const result = scanFlow(withoutComment, 0, lineNumber, flow)
      findings.push(...result.findings)
      flow = result.endIndex === null ? flow : null
      continue
    }

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

      if (rest[0] === "{" || rest[0] === "[") {
        flow = maybeStartFlowValue(withoutComment, restColumn - 1, lineNumber, findings)
        continue
      }

      const found = extractKey(rest)
      if (!found) continue
      const scope: Scope = { column: restColumn, keys: new Map() }
      scope.keys.set(found.key, { line: lineNumber, column: restColumn })
      stack.push(scope)

      flow = maybeStartFlowValue(withoutComment, restColumn - 1 + found.matchEnd, lineNumber, findings)
      continue
    }

    if (content[0] === "{" || content[0] === "[") {
      flow = maybeStartFlowValue(withoutComment, indent, lineNumber, findings)
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

    flow = maybeStartFlowValue(withoutComment, indent + found.matchEnd, lineNumber, findings)
  }

  return findings
}
