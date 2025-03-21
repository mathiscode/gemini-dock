import fs from 'fs'
import path from 'path'

const header = '#!/usr/bin/env node\n\n'
if (fs.existsSync(path.join(process.cwd(), 'dist/index.cjs'))) {
  const content = fs.readFileSync(path.join(process.cwd(), 'dist/index.cjs'), 'utf8')
  fs.writeFileSync(path.join(process.cwd(), 'dist/index.cjs'), header + content)
}
