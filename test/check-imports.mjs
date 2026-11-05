import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
const files = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (/\.(m?js)$/.test(entry.name)) files.push(p)
  }
}
for (const dir of ['src', 'scripts', 'test']) walk(dir)
let bad = 0
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const re = /(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/g
  let m
  while ((m = re.exec(text))) {
    const target = resolve(dirname(file), m[1])
    if (!existsSync(target)) { console.log('MISSING', file, '->', m[1]); bad++ }
  }
}
console.log(bad === 0 ? 'all relative imports resolve' : `${bad} broken imports`)
