import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { findDuplicateKeys } from "../src/parser.ts"

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")
}

test("flags a key repeated in a block mapping", () => {
  const findings = findDuplicateKeys(fixture("duplicate-block.yaml"))
  assert.equal(findings.length, 1)
  const [finding] = findings
  assert.equal(finding.rule, "duplicate-key")
  assert.equal(finding.message, 'key "name" is already defined at line 2')
  assert.deepEqual(finding.position, { line: 3, column: 3 })
  assert.deepEqual(finding.notePosition, { line: 2, column: 3 })
})

test("flags a key repeated inside a flow mapping, across entries", () => {
  const findings = findDuplicateKeys(fixture("duplicate-flow.yaml"))
  assert.equal(findings.length, 1)
  const [finding] = findings
  assert.deepEqual(finding.position, { line: 1, column: 27 })
  assert.deepEqual(finding.notePosition, { line: 1, column: 11 })
})

test("does not flag the same key appearing in separate sequence items", () => {
  // Each "- " opens a fresh scope, since list elements don't share keys
  // with their siblings.
  assert.deepEqual(findDuplicateKeys(fixture("sequence-items.yaml")), [])
})

test("checks the key text underneath an anchor, not the anchor tag itself", () => {
  const findings = findDuplicateKeys(fixture("anchor-duplicate.yaml"))
  assert.equal(findings.length, 1)
  const [finding] = findings
  assert.equal(finding.message, 'key "name" is already defined at line 2')
  assert.deepEqual(finding.position, { line: 3, column: 6 })
  assert.deepEqual(finding.notePosition, { line: 2, column: 6 })
})

test("reports nothing for a file with no duplicate keys", () => {
  assert.deepEqual(findDuplicateKeys(fixture("clean.yaml")), [])
})
