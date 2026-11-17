# AGENTS.md

Live English <-> Chinese captions for an in-person event. A static web app: an operator console
(`index.html`) listens to the speaker and shows captions plus a translation on a second window
(`display.html`). No build step, no runtime dependencies.

## Commands

- `npm ci` : install dev dependencies (ESLint only)
- `npm test` : unit tests (Node's built-in test runner, files in `tests/`)
- `npm run lint` : ESLint
- `npm run check:secrets` : fails if an API key is committed
- `npm run ci` : runs all of the above and prints a summary; this is what CI runs

## Layout

- `src/phrasebook.js` : exact phrase table, glossary, `normalize`, `findPhrase`
- `src/translate.js` : `CaptionTranslator` with provider fallback (chrome -> gemini -> mymemory) and a cache
- `src/speech.js` : `Listener`, a wrapper around the Web Speech API
- `src/app.js`, `src/display.js`, `src/bus.js` : browser UI code (needs a DOM; not unit tested)
- `tests/` : unit tests for the modules that run in Node

## Conventions

- Plain ES modules, no bundler, no TypeScript.
- Keep runtime code free of npm dependencies.
- API keys are entered in the console at runtime. Never put keys in source files.
- Keep changes small and focused. Run `npm run ci` before finishing.
