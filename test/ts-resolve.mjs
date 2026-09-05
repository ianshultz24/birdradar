/**
 * Extensionless-import resolver for `node --test`.
 *
 * Node 24 strips TypeScript types natively, so the source modules run under the
 * test runner with no build step and no dependencies. The one thing it will not
 * do is Node-style extension guessing: `import { parseObsDt } from './ebird'`
 * is a bare ESM specifier and resolves to nothing.
 *
 * Rewriting the app's imports to carry `.ts` extensions would be the wrong fix —
 * they are resolved by the bundler everywhere that matters, and the tests are
 * what should bend. This hook is loaded with `--import` and only fires for
 * relative specifiers that have no extension.
 *
 * Also maps the `@/…` alias from tsconfig.json's `paths`, so a test can import
 * the same way the app does.
 */

import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];

/** First existing `base + ext`, or null. Index files too, for directory imports. */
function firstExisting(base) {
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    const indexed = resolvePath(base, `index${ext}`);
    if (existsSync(indexed)) return indexed;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const aliased = specifier.startsWith('@/');
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    // Anything already carrying an extension, plus every bare package
    // specifier, goes straight to Node.
    if ((!aliased && !relative) || /\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(specifier, context);
    }

    const base = aliased
      ? resolvePath(REPO_ROOT, specifier.slice(2))
      : resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);

    const hit = firstExisting(base);
    if (!hit) return nextResolve(specifier, context);
    return { url: pathToFileURL(hit).href, shortCircuit: true };
  },
});
