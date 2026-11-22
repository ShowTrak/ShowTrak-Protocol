// `npm run build`: compiles every emitting config at the root, tsconfig.build.json
// and any tsconfig.build.<name>.json beside it, with the tooling's TypeScript.
//
// The apps run those root configs themselves (`npm run build:shared`), resolving
// their imports from the app's node_modules. Here there is none on that path, so
// a config with a counterpart in tooling/ (tooling/tsconfig.build.json) is built
// through that, which points the imports at tooling/node_modules; any other is
// built as it is, with the tooling's @types as its type roots.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TSC = path.join(__dirname, 'node_modules', 'typescript', 'bin', 'tsc');

const Configs = fs
  .readdirSync(ROOT)
  .filter((Name) => /^tsconfig\.build(\.[\w-]+)?\.json$/.test(Name))
  .sort();

for (const Name of Configs) {
  const Standalone = path.join(__dirname, Name);
  const Args = fs.existsSync(Standalone)
    ? ['-p', Standalone]
    : ['-p', path.join(ROOT, Name), '--typeRoots', path.join(__dirname, 'node_modules', '@types')];
  const Result = spawnSync(process.execPath, [TSC, ...Args], { cwd: ROOT, stdio: 'inherit' });
  if (Result.status !== 0) {
    console.error(`[build] ${Name} failed`);
    process.exit(Result.status || 1);
  }
  console.log(`[build] ${Name}`);
}
