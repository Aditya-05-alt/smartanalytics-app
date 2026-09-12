import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function resolveFile(absPath) {
  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) return absPath;
  if (fs.existsSync(`${absPath}.js`)) return `${absPath}.js`;
  if (fs.existsSync(`${absPath}.mjs`)) return `${absPath}.mjs`;
  if (fs.existsSync(`${absPath}.jsx`)) return `${absPath}.jsx`;
  const asIndex = path.join(absPath, 'index.js');
  if (fs.existsSync(asIndex)) return asIndex;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let candidate = specifier;
  if (specifier.startsWith('@/')) {
    candidate = path.join(process.cwd(), 'src', specifier.slice(2));
  } else if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const parent = context.parentURL
      ? path.dirname(new URL(context.parentURL).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      : process.cwd();
    // On Windows, file URLs may have leading slash before drive
    let parentDir = parent;
    if (context.parentURL?.startsWith('file:')) {
      parentDir = path.dirname(
        decodeURIComponent(new URL(context.parentURL).pathname).replace(/^\/([A-Za-z]:)/, '$1')
      );
    }
    if (specifier.startsWith('.')) {
      candidate = path.resolve(parentDir, specifier);
    }
  } else {
    return nextResolve(specifier, context);
  }

  const file = resolveFile(candidate);
  if (!file) {
    return nextResolve(specifier, context);
  }
  return nextResolve(pathToFileURL(file).href, context);
}
