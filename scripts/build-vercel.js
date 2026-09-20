import path from 'node:path';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { sanitizeDashboard } from './export-public-data.js';

const root = process.cwd();
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== path.resolve(root) || path.basename(output) !== 'dist') throw new Error('Invalid build output directory.');
const snapshot = sanitizeDashboard(JSON.parse(await readFile(path.join(root, 'public-data/dashboard.json'), 'utf8')));
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'data'), { recursive: true });
await cp(path.join(root, 'src/web/public'), output, { recursive: true });
const indexPath = path.join(output, 'index.html');
const html = await readFile(indexPath, 'utf8');
if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('index.html must contain a head element.');
await writeFile(indexPath, html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}\n<meta name="rp-runtime" content="vercel">`));
await writeFile(path.join(output, 'data/dashboard.json'), `${JSON.stringify(snapshot)}\n`);
await build({
  entryPoints: [path.join(root, 'src/browser/visitorClient.js')],
  outfile: path.join(output, 'visitorClient.js'),
  bundle: true, format: 'esm', platform: 'browser', target: ['es2022'],
  minify: true, sourcemap: false, logLevel: 'info'
});
console.log(`Built Vercel site with ${snapshot.papers.length} public paper records.`);
