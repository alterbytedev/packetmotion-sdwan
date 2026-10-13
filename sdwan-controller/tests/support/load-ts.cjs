const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute actual controller modules; replace only framework/request and database boundaries.
module.exports = function loader(mocks = {}) {
  const cache = new Map();
  function load(path) {
    const absolute = resolve(path);
    if (cache.has(absolute)) return cache.get(absolute);
    const source = ts.transpileModule(readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    cache.set(absolute, exports);
    vm.runInNewContext(source, {
      exports,
      require: (name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name === 'server-only') return {};
        if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
        if (name.startsWith('.')) return load(resolve(dirname(absolute), `${name}.ts`));
        return require(name);
      },
      process, Buffer, Date, Map, Request, Response, URL, URLSearchParams, TextDecoder, Uint8Array, console,
    }, { filename: absolute });
    return exports;
  }
  return load;
};
