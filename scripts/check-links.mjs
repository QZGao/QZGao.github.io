import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return files.flat();
}

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function candidatesFor(urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (decoded === '') return [path.join(root, 'index.html')];
  if (decoded.endsWith('/')) return [path.join(root, decoded, 'index.html')];
  if (path.extname(decoded)) return [path.join(root, decoded)];
  return [path.join(root, decoded), path.join(root, decoded, 'index.html')];
}

const htmlFiles = (await walk(root)).filter((file) => file.endsWith('.html'));
const failures = [];

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const links = [...html.matchAll(/\bhref=(?:"([^"]+)"|'([^']+)')/g)]
    .map((match) => match[1] ?? match[2])
    .filter((href) => href.startsWith('/') && !href.startsWith('//'));

  for (const href of links) {
    const urlPath = href.split(/[?#]/, 1)[0];
    if (urlPath === '') continue;
    const candidates = candidatesFor(urlPath);
    if (!(await Promise.all(candidates.map(exists))).some(Boolean)) {
      failures.push(`${path.relative(root, file)} → ${href}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken internal links (${failures.length}):\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Checked internal links in ${htmlFiles.length} generated HTML files.`);
}
