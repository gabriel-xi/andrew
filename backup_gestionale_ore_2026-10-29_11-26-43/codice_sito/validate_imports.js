const fs = require('fs');
const path = require('path');

const dir = '/Users/andrea/.gemini/antigravity/scratch/gestione_ore_v2/static/js';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

// Collect all exports
const exportsMap = {};
files.forEach(f => {
  const code = fs.readFileSync(path.join(dir, f), 'utf-8');
  const exportMatches = [
    ...code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+([a-zA-Z0-9_$]+)/g)
  ];
  exportsMap[f] = new Set(exportMatches.map(m => m[1]));
});

console.log("Found exports:", exportsMap);

// Check all imports
let hasError = false;
files.forEach(f => {
  const code = fs.readFileSync(path.join(dir, f), 'utf-8');
  const importLines = code.split('\n').filter(l => l.trim().startsWith('import '));
  importLines.forEach(line => {
    const namedMatch = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"]/);
    if (namedMatch) {
      const names = namedMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      let targetFile = namedMatch[2];
      if (!targetFile.endsWith('.js')) targetFile += '.js';
      names.forEach(name => {
        // Handle alias: foo as bar
        const origName = name.split(/\s+as\s+/)[0].trim();
        if (!exportsMap[targetFile] || !exportsMap[targetFile].has(origName)) {
          console.error(`❌ IMPORT ERROR in ${f}: '${origName}' is NOT exported by ${targetFile}!`);
          hasError = true;
        }
      });
    }
  });
});

if (!hasError) {
  console.log("✅ All named imports match declared exports!");
}
