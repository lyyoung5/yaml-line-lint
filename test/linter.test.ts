import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { lint } from "../src/linter.ts"
import { parseConfig } from "../src/config.ts"

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")
}

test("flags a tab used in indentation", () => {
  const findings = lint(fixture("tabs.yaml"))
  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, "no-tabs")
  assert.equal(findings[0].severity, "error")
  assert.deepEqual(findings[0].position, { line: 2, column: 1 })
})

test("reports nothing for a clean file", () => {
  assert.deepEqual(lint(fixture("clean.yaml")), [])
})

// Built inline rather than as a fixture file: trailing whitespace doesn't
// survive being checked in, since every editor save path here strips it.
test("flags trailing whitespace as a warning", () => {
  const text = "service: value  \nport: 8080\n"
  const findings = lint(text)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, "trailing-whitespace")
  assert.equal(findings[0].severity, "warning")
  assert.deepEqual(findings[0].position, { line: 1, column: 15 })
  assert.equal(findings[0].length, 2)
})

test("sorts findings from different rules by line then column", () => {
  const text = "service:\n  name: original  \n  name: overridden\n"
  const findings = lint(text)
  assert.deepEqual(
    findings.map((f) => [f.rule, f.position.line]),
    [
      ["trailing-whitespace", 2],
      ["duplicate-key", 3],
    ],
  )
})

test("config overrides apply: a rule set to off drops its findings, others can change severity", () => {
  const config = parseConfig(fixture("sample-config.json"), "sample-config.json")

  const trailingText = "service: value  \nport: 8080\n"
  assert.deepEqual(lint(trailingText, config), [])

  const tabsFindings = lint(fixture("tabs.yaml"), config)
  assert.equal(tabsFindings.length, 1)
  assert.equal(tabsFindings[0].rule, "no-tabs")
  assert.equal(tabsFindings[0].severity, "warning")
})
