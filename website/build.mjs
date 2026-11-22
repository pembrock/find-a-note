import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const output = new URL('dist/', root);
const repository = 'https://github.com/pembrock/find-a-note';
const releases = repository + '/releases';
const latest = releases + '/latest';

const read = (path) => readFile(new URL(path, root), 'utf8');
const [template, russian, releaseData] = await Promise.all([
  read('site/page.html'), read('content/ru.json'), read('content/release.json'),
]);
const release = JSON.parse(releaseData);
const verifiedTag = /^v\d+\.\d+\.\d+$/.test(release.tag);
const releasePage = verifiedTag ? releases + '/tag/' + release.tag : latest;

function assetUrl(key, suffix) {
  if (!verifiedTag) return latest;
  const prefix = releases + '/download/' + release.tag + '/';
  const filename = key === 'checksums' ? suffix : 'Find-a-Note-' + release.tag.slice(1) + '-' + suffix;
  return release[key] === prefix + filename ? release[key] : latest;
}

const shared = {
  latest: releasePage,
  tag: verifiedTag ? release.tag : '',
  repositoryUrl: repository,
  releasesUrl: releases,
  checksumsUrl: assetUrl('checksums', 'SHA256SUMS.txt'),
  setupUrl: assetUrl('setup', 'Windows-Setup.exe'),
  portableUrl: assetUrl('portable', 'Windows-Portable.exe'),
  macUrl: assetUrl('mac', 'macOS-arm64.dmg'),
};

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function render(locale, links) {
  const values = { ...locale, ...shared, ...links };
  return template.replace(/{{(\w+)}}/g, (_, key) => {
    if (typeof values[key] !== 'string') throw new Error('Missing template value: ' + key);
    return values[key].replace(/[&<>"']/g, (character) => entities[character]);
  });
}

await mkdir(output, { recursive: true });
await cp(new URL('site/assets/', root), new URL('assets/', output), { recursive: true });
await cp(new URL('site/style.css', root), new URL('style.css', output));
await writeFile(new URL('.nojekyll', output), '');
await writeFile(new URL('index.html', output), render(JSON.parse(russian), {
  installUrl: repository + '/blob/main/docs/INSTALL-RU.md',
}));
console.log('Built website/dist');
