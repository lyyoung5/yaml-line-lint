# yaml-line-lint

A YAML linter that reports every finding with an exact line, column, and
source snippet, the way a compiler error looks rather than the way most
YAML tooling looks.

## The problem

YAML is whitespace-sensitive in ways that bite silently. Two of the more
common ones:

- A key repeated at the same indentation level doesn't error. The parser
  just keeps the last value and drops the first, and you find out later
  when a setting you swore you configured has no effect.
- Mixing tabs into indentation is invalid YAML, but the error message
  from most parsers ("bad indentation" with no column, or a stack trace
  from whatever library the tool embeds) doesn't tell you which line or
  which character to fix.

This tool exists to catch exactly these mistakes and point at them
precisely, instead of leaving you to bisect a 200-line config file by
eye.

## Usage

No install step: this runs straight off the TypeScript source using
Node's built-in type stripping (Node 22.6+, no flag needed on Node
23.6+).

```
node --experimental-strip-types src/cli.ts config.yaml
```

Given a file like:

```yaml
service:
  name: original
  name: overridden
  port: 8080
```

it prints:

```
config.yaml:3:3: error [duplicate-key] key "name" is already defined at line 2
  |
3 |   name: overridden
  |   ^^^^
 = note: first definition of "name", at config.yaml:2:3
  |
2 |   name: original
  |

1 error(s), 0 warning(s)
```

The exit code is 1 if any errors were found, 0 otherwise, so it works
as a CI gate.

### JSON output

Pass `--format json` to get machine-readable output instead, for
feeding into another tool:

```
node --experimental-strip-types src/cli.ts --format json config.yaml
```

```json
{
  "files": [
    {
      "file": "config.yaml",
      "findings": [
        {
          "rule": "duplicate-key",
          "severity": "error",
          "message": "key \"name\" is already defined at line 2",
          "position": { "line": 3, "column": 3 },
          "length": 4,
          "note": "first definition of \"name\"",
          "notePosition": { "line": 2, "column": 3 }
        }
      ]
    }
  ],
  "errors": 1,
  "warnings": 0
}
```

A file that can't be read shows up as `{ "file": "...", "error": "..." }`
instead of a `findings` array. The exit code rule is the same either
way: 1 if `errors` is greater than zero.

### Configuring rules

By default `yamlint` looks for a `.yamllint.json` file in the current
directory. If one exists, it can turn rules off or change their
severity:

```json
{
  "rules": {
    "trailing-whitespace": "off",
    "no-tabs": "warning"
  }
}
```

A rule left out of the `rules` object keeps its built-in default. Valid
settings are `"error"`, `"warning"`, and `"off"`. Pass `--config <path>`
to use a config file at a different location instead of the default
one; unlike the automatic lookup, a missing or invalid `--config` path
is an error.

```
node --experimental-strip-types src/cli.ts --config ci/yamllint.json config.yaml
```

## Running the tests

```
npm test
```

This runs `node --test` against the files in `test/`, using Node's
built-in test runner (`node:test` / `node:assert`) -- no test framework
dependency. Most cases load a fixture from `test/fixtures/`; a couple
that need trailing whitespace in the input are built as inline strings
in the test file instead, since checked-in fixtures don't survive an
editor stripping trailing whitespace on save.

## Rules implemented so far

| rule                  | severity | catches                                              |
|------------------------|----------|-------------------------------------------------------|
| `duplicate-key`         | error    | a mapping key repeated at the same nesting level      |
| `no-tabs`               | error    | a tab character used in leading indentation           |
| `trailing-whitespace`   | warning  | trailing spaces or tabs at the end of a line          |

## How it works

There's no full YAML parser here. `src/parser.ts` walks the document
line by line and tracks an indentation scope stack: each mapping key
column pushes or reuses a scope, and each sequence item (`- `) always
opens a fresh scope, since list elements don't share keys with their
siblings. That's enough structure to catch duplicate keys correctly
across nested block mappings and sequences without the overhead of
building a full AST.

Flow-style collections (`{a: 1}`, `[1, 2, 3]`) get a separate pass:
once a value opens a `{` or `[`, the scanner switches to tracking
brackets and commas instead of columns, since flow entries don't line
up with indentation. Duplicate keys are still caught inside flow
mappings, including ones that span multiple lines.

## Known limitations

This covers block-style and flow-style YAML, which between them are
what almost every config file uses. It does not currently handle:

- The flow-sequence shorthand for single-pair mappings (`[a: 1, b: 2]`,
  equivalent to `[{a: 1}, {b: 2}]`) -- entries there are treated as
  plain values, not keys
- Multi-document files (content after a second `---` is scanned as if
  it were a continuation of the same document)
- Schema or type validation (this is a syntax/style linter, not a
  validator against your app's config shape)

Anchors (`&name`) on a key are recognized and skipped over, so
`&anchor name: value` still checks `name` for duplicates rather than
treating `&anchor name` as the key text. Aliases (`*name`) are only
ever values, so they need no special handling, and a merge key
(`<<:`) is checked like any other key -- a mapping with two `<<:`
entries at the same level is flagged the same way two `name:` entries
would be.

## License

MIT, see LICENSE.
