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

## Known limitations

This covers block-style YAML, which is what almost every config file
uses. It does not currently handle:

- Flow-style collections (`{a: 1}`, `[1, 2, 3]`)
- Multi-document files (content after a second `---` is scanned as if
  it were a continuation of the same document)
- Anchors, aliases, and merge keys (`&foo`, `*foo`, `<<:`)
- Schema or type validation (this is a syntax/style linter, not a
  validator against your app's config shape)

## License

MIT, see LICENSE.
