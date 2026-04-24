import { build, context } from 'esbuild';
import { readFileSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/** Three artefacts shipped to Oscarr:
 *   - dist/index.js              — backend bundle (platform=node)
 *   - dist/frontend/index.js     — admin-tab React component (platform=browser)
 *   - dist/frontend/index.css    — this plugin's own Tailwind utility bundle
 *
 *  The CSS bundle matters: Oscarr's core frontend purges its own Tailwind against its own
 *  source tree, so any `ndp-*` / `border-ndp-warning/30` etc. used only inside this plugin
 *  would never get emitted. The plugin loader auto-injects our <link rel="stylesheet">
 *  when our first component mounts, so utilities resolve locally — see the 0.7.0 plugin CSS
 *  isolation patch. `react` / `react-dom` / `react/jsx-runtime` / `@oscarr/sdk` are kept
 *  external so we don't double-embed React (that's what the host importmap is for). */

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// ── Backend bundle ──────────────────────────────────────────────────

/** @type {import('esbuild').BuildOptions} */
const backendOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'module';",
      "const require = __createRequire(import.meta.url);",
    ].join('\n'),
  },
  external: [
    // Discord.js carries native deps (zlib-sync, @discordjs/opus) and does weird dynamic
    // require() patterns for voice support we don't use — bundling it half-works at best.
    'discord.js',
    '@discordjs/rest',
    '@discordjs/ws',
    // Oscarr's plugin context is injected at runtime — must NOT be bundled.
    '@oscarr/shared',
  ],
  minify: !watch,
  sourcemap: watch ? 'inline' : 'linked',
  logLevel: 'info',
};

// ── Frontend bundle (admin tab) ─────────────────────────────────────

/** @type {import('esbuild').BuildOptions} */
const frontendOptions = {
  entryPoints: ['frontend/index.tsx'],
  bundle: true,
  platform: 'browser',
  target: ['es2022'],
  format: 'esm',
  outfile: 'dist/frontend/index.js',
  jsx: 'automatic',
  jsxImportSource: 'react',
  external: [
    // These come from Oscarr's importmap (packages/frontend/public/_plugin-runtime/).
    // Bundling would re-inline a second React copy and trigger "Invalid hook call".
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@oscarr/sdk',
  ],
  minify: !watch,
  sourcemap: watch ? 'inline' : 'linked',
  logLevel: 'info',
};

// ── Tailwind CSS bundle ─────────────────────────────────────────────
// Runs the tailwindcss CLI in-process so plugin utilities (border-ndp-warning/30, etc.)
// get emitted into this plugin's own stylesheet rather than relying on core's purge.
const tailwindArgs = [
  '-c', resolve(__dirname, 'tailwind.config.js'),
  '-i', resolve(__dirname, 'frontend/index.css'),
  '-o', resolve(__dirname, 'dist/frontend/index.css'),
  ...(watch ? ['--watch'] : ['--minify']),
];

if (watch) {
  const [backCtx, frontCtx] = await Promise.all([context(backendOptions), context(frontendOptions)]);
  await Promise.all([backCtx.watch(), frontCtx.watch()]);
  const twChild = spawn('npx', ['tailwindcss', ...tailwindArgs], { stdio: 'inherit', cwd: __dirname });
  twChild.on('exit', (code) => { if (code !== null && code !== 0) process.exit(code); });
  console.log(`[leonarr ${pkg.version}] watching src/ + frontend/ (+ tailwind) …`);
} else {
  await build(backendOptions);
  await build(frontendOptions);
  const twResult = spawnSync('npx', ['tailwindcss', ...tailwindArgs], { stdio: 'inherit', cwd: __dirname });
  if (twResult.status !== 0) process.exit(twResult.status || 1);
  console.log(`[leonarr ${pkg.version}] built dist/index.js + dist/frontend/index.{js,css}`);
}
