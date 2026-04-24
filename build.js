import { build, context } from 'esbuild';
import { readFileSync } from 'fs';

/** Bundles src/index.js → dist/index.js for Oscarr's plugin loader. discord.js and its
 *  transitive native deps (@discordjs/opus, zlib-sync, …) are kept external so the loader
 *  resolves them from the plugin's own node_modules at runtime — esbuild can't inline native
 *  modules anyway. @oscarr/shared type-only imports get stripped by the ESM bundler. */
const watch = process.argv.includes('--watch');

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('esbuild').BuildOptions} */
const options = {
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

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`[leonarr ${pkg.version}] watching src/…`);
} else {
  await build(options);
}
