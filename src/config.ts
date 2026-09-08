// Config format: a JSON object with a "rules" map from rule name to
// "error", "warning", or "off". Rules left out of the map keep their
// built-in default severity. This module only parses and validates --
// reading the file from disk is the CLI's job, so the parsing logic can
// be exercised without touching the filesystem.

export type Severity = "error" | "warning"
export type RuleSetting = Severity | "off"

export const RULE_NAMES = ["duplicate-key", "no-tabs", "trailing-whitespace"] as const
export type RuleName = (typeof RULE_NAMES)[number]

export type Config = Record<RuleName, RuleSetting>

const DEFAULT_SEVERITIES: Config = {
  "duplicate-key": "error",
  "no-tabs": "error",
  "trailing-whitespace": "warning",
}

function isRuleName(name: string): name is RuleName {
  return (RULE_NAMES as readonly string[]).includes(name)
}

export function defaultConfig(): Config {
  return { ...DEFAULT_SEVERITIES }
}

// Parses and validates a config file's contents. `sourceLabel` is used
// only to make error messages point at the right file.
export function parseConfig(text: string, sourceLabel: string): Config {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`${sourceLabel}: invalid JSON (${(err as Error).message})`)
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${sourceLabel}: expected a JSON object at the top level`)
  }

  const rulesField = (raw as Record<string, unknown>).rules
  const config = defaultConfig()
  if (rulesField === undefined) return config

  if (typeof rulesField !== "object" || rulesField === null || Array.isArray(rulesField)) {
    throw new Error(`${sourceLabel}: "rules" must be an object`)
  }

  for (const [name, value] of Object.entries(rulesField as Record<string, unknown>)) {
    if (!isRuleName(name)) {
      throw new Error(`${sourceLabel}: unknown rule "${name}" (known rules: ${RULE_NAMES.join(", ")})`)
    }
    if (value !== "error" && value !== "warning" && value !== "off") {
      throw new Error(
        `${sourceLabel}: rule "${name}" must be "error", "warning", or "off", got ${JSON.stringify(value)}`,
      )
    }
    config[name] = value
  }

  return config
}
