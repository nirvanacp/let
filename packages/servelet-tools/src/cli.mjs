#!/usr/bin/env node
// node:wasi warns that it is experimental each time it loads; the runner uses only its stable
// preview1 import object, so the warning is dropped before the commands are imported.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning?.message ?? warning).includes('WASI')) return;
  emitWarning.call(process, warning, ...rest);
};
const { createServelet } = await import('./create.mjs');
const { buildServelet } = await import('./build.mjs');
const { checkServelet } = await import('./check.mjs');
const { runServelet } = await import('./run.mjs');

class UsageError extends Error { constructor(message) { super(message); this.code = 'USAGE'; } }

function parse(args, permitted) {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
    const name = args[i].slice(2);
    if (!permitted.includes(name) || Object.hasOwn(options, name)) throw new UsageError(`Unknown or duplicate option --${name}`);
    if (name === 'json') options.json = true;
    else if (!args[i + 1] || args[i + 1].startsWith('--')) throw new UsageError(`Missing --${name} value`);
    else options[name] = args[++i];
  }
  return { positional, options };
}

const help = `let-servelet
  create <directory> [--id <id>] [--name <name>]
         [--language go] [--framework default|chi|gin|echo]
         [--runtime local] [--engine wasm]       default go, default, local, wasm
  build <directory>                              writes <directory>/dist/servelet.wasm
  check <directory>                              builds, then sends the health request and
                                                 checks.json to the module over a throwaway database
  run <directory> [--port 8790] [--database <file>]
                                                 serves the module on 127.0.0.1 over HTTP;
                                                 default database <directory>/dist/run.sqlite3
build needs Go 1.24 or later on PATH. It writes dist/go.work, which adds the Let Go library,
then runs go mod download, go vet and go build for GOOS=wasip1 GOARCH=wasm.
check and run execute the servelet's code in Node with no time limit; run only servelets
you trust. Every command accepts --json.`;

function one(positional, what) {
  if (positional.length !== 1) throw new UsageError(`Expected one ${what}`);
  return positional[0];
}

async function main(args) {
  const [command] = args;
  switch (command) {
    case 'create': {
      const { positional, options } = parse(args.slice(1), ['json', 'id', 'name', 'language', 'framework', 'runtime', 'engine']);
      return ['create', await createServelet(one(positional, 'target directory'), options)];
    }
    case 'build': {
      const { positional } = parse(args.slice(1), ['json']);
      return ['build', await buildServelet(one(positional, 'servelet directory'))];
    }
    case 'check': {
      const { positional } = parse(args.slice(1), ['json']);
      return ['check', await checkServelet(one(positional, 'servelet directory'))];
    }
    case 'run': {
      const { positional, options } = parse(args.slice(1), ['json', 'port', 'database']);
      if (options.port !== undefined && !/^\d+$/.test(options.port)) throw new UsageError('--port takes a number');
      return ['run', await runServelet(one(positional, 'servelet directory'), options)];
    }
    default:
      throw new UsageError(command ? `Unknown command ${command}` : help);
  }
}

const args = process.argv.slice(2), json = args.includes('--json');
if (args.length === 0 || args.includes('--help') || args[0] === 'help') {
  console.log(json ? JSON.stringify({ ok: true, command: 'help', result: { help } }) : help);
} else {
  try {
    const [command, result] = await main(args);
    console.log(json ? JSON.stringify({ ok: true, command, result }) : `${command} passed\n${JSON.stringify(result, null, 2)}`);
  } catch (error) {
    if (json) console.log(JSON.stringify({ ok: false, command: args[0], error: { code: error.code ?? 'FAILURE', message: error.message } }));
    else console.error(error.code && error.code !== 'USAGE' ? `${error.code}: ${error.message}` : error.message);
    process.exitCode = error.code === 'USAGE' ? 2 : 1;
  }
}
