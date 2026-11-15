import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// The kit is the Let root's AGENTS.md and README.md plus the whole factory/ tree, so the links
// between the applet and servelet guidance resolve the same way in the kit and in the repository.
const output = fileURLToPath(new URL('./kit/', import.meta.url));
const source = fileURLToPath(new URL('../../', import.meta.url));
await rm(output, { recursive: true, force: true }); await mkdir(output);
for (const name of ['AGENTS.md', 'README.md', 'factory']) await cp(path.join(source, name), path.join(output, name), { recursive: true });
