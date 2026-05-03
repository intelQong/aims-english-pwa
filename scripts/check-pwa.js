const fs = require('node:fs');
const path = require('node:path');

const distDir = path.join(process.cwd(), 'dist');
const requiredFiles = ['index.html', 'manifest.json', 'sw.js'];

for (const file of requiredFiles) {
  const fullPath = path.join(distDir, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`Missing required PWA file: ${file}`);
    process.exit(1);
  }
}

const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
if (!indexHtml.includes('rel="manifest"')) {
  console.error('index.html is missing manifest link tag.');
  process.exit(1);
}
if (!indexHtml.includes('navigator.serviceWorker.register')) {
  console.error('index.html does not appear to register a service worker.');
  process.exit(1);
}

console.log('PWA checks passed.');
