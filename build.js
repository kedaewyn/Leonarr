import { build, context } from 'esbuild';
import { readFileSync } from 'fs';

/** Two bundles: backend (src/index.ts → dist/index.js, platform=node) and admin-tab
 *  frontend (frontend/index.tsx → dist/frontend/index.js, platform=browser). Oscarr's
 *  loader serves `dist/frontend/*` back to the admin UI via `/api/plugins/:id/frontend/*`
 *  and resolves `react` / `react-dom` / `react/jsx-runtime` from the host via importmap —
 *  that's why those (and `@oscarr/sdk`) are marked external here. */

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

if (watch) {
  const [backCtx, frontCtx] = await Promise.all([context(backendOptions), context(frontendOptions)]);
  await Promise.all([backCtx.watch(), frontCtx.watch()]);
  console.log(`[leonarr ${pkg.version}] watching src/ + frontend/ …`);
} else {
  await build(backendOptions);
  await build(frontendOptions);
  console.log(`[leonarr ${pkg.version}] built dist/index.js + dist/frontend/index.js`);
}
