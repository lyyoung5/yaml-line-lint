import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { defaultConfig, parseConfig } from "../src/config.ts"

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")
}

test("a config with no rules field falls back to the built-in defaults", () => {
  assert.deepEqual(parseConfig("{}", "test.json"), defaultConfig())
})

test("parses severity overrides and leaves other rules at their default", () => {
  const config = parseConfig(fixture("sample-config.json"), "sample-config.json")
  assert.equal(config["trailing-whitespace"], "off")
  assert.equal(config["no-tabs"], "warning")
  assert.equal(config["duplicate-key"], "error")
})

test("rejects invalid JSON", () => {
  assert.throws(() => parseConfig("{", "bad.json"), /invalid JSON/)
})

test("rejects a non-object top level", () => {
  assert.throws(() => parseConfig("[]", "bad.json"), /expected a JSON object/)
})

test("rejects a rules field that isn't an object", () => {
  assert.throws(() => parseConfig('{"rules": "off"}', "bad.json"), /"rules" must be an object/)
})

test("rejects an unknown rule name", () => {
  assert.throws(() => parseConfig('{"rules": {"no-such-rule": "error"}}', "bad.json"), /unknown rule/)
})

test("rejects an invalid rule setting", () => {
  assert.throws(
    () => parseConfig('{"rules": {"no-tabs": "critical"}}', "bad.json"),
    /must be "error", "warning", or "off"/,
  )
})
