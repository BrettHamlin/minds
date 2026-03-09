# @pipelang Mind Profile

## Domain

The `.pipeline` DSL: lexer, parser, AST, compiler, validator, diff, and language server protocol. Transforms pipeline source files into the `CompiledPipeline` JSON format consumed by pipeline_core.

## Conventions

- **Always parse before compiling**: `source → parse() → AST → compile() → CompiledPipeline`. Never skip the parse step.
- Compiler output must conform to the `CompiledPipeline` type from `pipeline_core` — use `import type` for type-only imports and regular static imports for runtime values (e.g., `import type { CompiledPipeline } from "../../../minds/pipeline_core/types"`).
- Validator errors are returned as an array — never throw on invalid input, return `{ valid: false, errors: [...] }`.
- LSP protocol messages follow the JSON-RPC 2.0 spec — do not invent a custom protocol.
- DSL keywords are defined in the lexer — add new keywords there first, then update parser + compiler.

## Key Files

- `minds/pipelang/src/lexer.ts` — tokenizer for `.pipeline` source
- `minds/pipelang/src/parser.ts` — token stream → AST
- `minds/pipelang/src/compiler.ts` — AST → CompiledPipeline JSON
- `minds/pipelang/src/validator.ts` — validates compiled pipeline structure

## Anti-Patterns

- Compiling source directly to JSON without going through the parser (bypass is fragile and untestable).
- Duplicating the `CompiledPipeline` type locally instead of importing from pipeline_core.
- Throwing exceptions from the validator (return errors in the array instead).
- Hardcoding phase names or signal suffixes in the compiler (these come from the pipeline_core types).

## Review Focus

- Parse → AST → compile pipeline is intact (no shortcut paths).
- Cross-Mind types imported via `import type` (not duplicated locally).
- Validator returns structured errors, never throws.
- New DSL keywords are added to the lexer before appearing in parser/compiler.
