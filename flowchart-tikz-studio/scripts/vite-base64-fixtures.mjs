import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Test-only: `import data from './file.png?b64'` yields the file's bytes as a
 * base64 string, so binary fixtures (PNG, JPEG) can be used by the Vitest
 * suite without Node typings or a fixtures server.
 */
export function base64Fixtures() {
  const PREFIX = '\0b64:';
  return {
    name: 'base64-fixtures',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!id.endsWith('?b64') || !importer) return null;
      return PREFIX + resolve(dirname(importer), id.slice(0, -4));
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      return `export default ${JSON.stringify(readFileSync(id.slice(PREFIX.length)).toString('base64'))};`;
    },
  };
}
