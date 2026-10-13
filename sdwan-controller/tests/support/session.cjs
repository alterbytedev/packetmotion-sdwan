const { readFileSync } = require('node:fs');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync('src/lib/session.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sessionModule = { exports: {} };
new Function('exports', 'require', source)(sessionModule.exports, require);

module.exports = sessionModule.exports;
