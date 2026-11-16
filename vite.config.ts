import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Honor PORT when a tool (like the Claude preview pane) assigns one.
const port = process.env.PORT ? Number(process.env.PORT) : undefined;

/** Recursively list files under `dir` as relative URL paths, skipping dotfiles. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) =>
      entry.isDirectory() ? listFiles(join(dir, entry.name)).map((f) => `${entry.name}/${f}`) : [entry.name],
    );
}

/**
 * Emits sw.js from src/service-worker.js with the list of files to precache.
 * Fonts: only the Latin .woff2 files are precached (browsers here use woff2,
 * and the app is English); other subsets are still cached if ever requested.
 */
function serviceWorker(): Plugin {
  return {
    name: 'emilys-timer-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const isWanted = (file: string) =>
        !/\.(woff2?|ttf)$/.test(file) || /-latin-\d.*\.woff2$/.test(file);
      const files = [
        './',
        ...Object.keys(bundle).filter((f) => f !== 'index.html' && isWanted(f)),
        ...listFiles('public'),
      ];
      // Built assets have content hashes in their names; public files don't, so
      // hash their contents too. Any change → new version → fresh cache.
      const hash = createHash('sha256').update(files.join('\n'));
      for (const f of listFiles('public')) hash.update(readFileSync(join('public', f)));
      const version = hash.digest('hex').slice(0, 12);
      const source = readFileSync('src/service-worker.js', 'utf8')
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(files)};`)
        .replace("const CACHE = 'emilys-timer-' + __VERSION__;", `const CACHE = 'emilys-timer-${version}';`);
      if (source.includes('__PRECACHE__') || source.includes('__VERSION__')) {
        this.error('service-worker.js placeholders were not filled in');
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages
  // serves it at /<repo-name>/).
  base: './',
  plugins: [serviceWorker()],
  server: { port: port ?? 5173 },
  preview: { port: port ?? 4173 },
});
