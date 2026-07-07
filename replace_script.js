const fs = require('fs');
const path = require('path');

const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'screenshots', '.wrangler'];
const excludeFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'redskypng3.png', 'logo.png', 'favicon.webp', 'favicon.ico', 'favicon.png', 'replace_script.js', 'obex_cat_eye_logo-256.webp'];

function replaceInFile(filePath) {
  try {
    const ext = path.extname(filePath);
    if (['.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif'].includes(ext)) {
      return; // Skip binary images
    }

    let content = fs.readFileSync(filePath, 'utf8');
    let newContent = content;

    // Replace obex_cat_eye_logo-256.webp with logo.png
    newContent = newContent.replace(/obex_cat_eye_logo-256\.webp/g, 'logo.png');

    // Replace text
    newContent = newContent.replace(/OBEX/g, 'REDSKY');
    newContent = newContent.replace(/Obex/g, 'Redsky');
    newContent = newContent.replace(/obex/g, 'redsky');

    if (content !== newContent) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      console.log(`Updated: ${filePath}`);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}: ${err.message}`);
  }
}

function traverseDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!excludeDirs.includes(file)) {
        traverseDir(fullPath);
      }
    } else {
      if (!excludeFiles.includes(file)) {
        replaceInFile(fullPath);
      }
    }
  }
}

traverseDir(__dirname);
console.log('Replacement complete.');
