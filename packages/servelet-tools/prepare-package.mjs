import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// A published package has no Let repository around it, so it carries its own copy of the Go
// servelet library and the servelet templates. src/locate.mjs uses these copies only when the
// tools do not run from a Let checkout.
const root = fileURLToPath(new URL('../../', import.meta.url));
const copies = [['go/servelet', 'go/servelet'], ['factory/servelets/templates', 'templates']];
for (const [from, to] of copies) {
  const output = fileURLToPath(new URL(to, import.meta.url));
  await rm(output, { recursive: true, force: true });
  await cp(path.join(root, from), output, { recursive: true });
}
