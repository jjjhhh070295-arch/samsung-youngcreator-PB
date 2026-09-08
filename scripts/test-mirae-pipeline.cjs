/* UI-free isolated verification only: no installer, host environment, or remote service.
 * Runtime guards are application-process controls, not an OS/network sandbox.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { threadId } = require('node:worker_threads');
const writeAuditSync = fs.writeSync.bind(fs);
const BLOCK_EVENT_PREFIX = 'MIRAE_PIPELINE_NETWORK_BLOCK_EVENT=';
const READY_EVENT_PREFIX = 'MIRAE_PIPELINE_GUARD_READY=';

const ROOT = path.resolve(__dirname, '..');
const SOURCE_FILES = Object.freeze([
  'lib/researchIdeas/pipeline.ts',
  'lib/researchIdeas/pipeline.test.ts',
  'lib/researchIdeas/collector.ts',
  'lib/researchIdeas/collector.test.ts',
  'lib/researchIdeas/extract.ts',
  'lib/researchIdeas/extract.test.ts',
  'lib/researchIdeas/providers/miraeTopPicks.ts',
  'lib/researchIdeas/providers/miraeTopPicks.test.ts',
]);
const UNIT_FILES = SOURCE_FILES.filter(file => /\.test\.tsx?$/.test(file));
// Eight package-script tests reviewed at e15cf48d41458610d82848730cfde73048af2de3.
// Keep them separate from the four new tests; an older six-test copy must not pass
// as the latest main. This runner never copies or modifies those business tests.
const REGRESSION_FILES = Object.freeze([
  'lib/advisory/control.test.ts',
  'lib/advisory/krTrendFilter.test.ts',
  'lib/advisory/bondInstrumentCatalog.test.ts',
  'lib/advisory/mergeTrendInstruments.test.ts',
  'lib/manualPortfolioDraft.test.ts',
  'lib/portfolioAnalytics/analytics.test.ts',
  'lib/advisory/portfolioReturn.test.ts',
  'lib/investmentSurvey.test.ts',
]);
const localRequire = Module.createRequire(path.join(ROOT, 'package.json'));

function platformPaths(platform) {
  if (platform === 'win32') return path.win32;
  if (platform === 'linux') return path.posix;
  throw new Error('Only Windows and Linux verification rules are supported.');
}

/** Pure constructor: all platform inputs are injected; no host environment access. */
function buildSyntheticEnvironment({ platform, root, execPath, preloadPath, mode = 'test' }) {
  const api = platformPaths(platform);
  const absolute = value => typeof value === 'string' && !/[\x00-\x1f"\x7f]/.test(value)
    && api.isAbsolute(value) && (platform !== 'win32' || /^[a-z]:[\\/]/i.test(value));
  if (![root, execPath, preloadPath].every(absolute) || !['test', 'production'].includes(mode)
    || api.dirname(execPath).includes(api.delimiter)) throw new Error('Invalid synthetic environment input.');
  const expectedPreload = api.join(root, 'scripts', 'test-mirae-pipeline.cjs');
  if (api.normalize(preloadPath) !== expectedPreload) throw new Error('Unexpected verification preload path.');
  const temp = api.join(root, '.next', 'tmp');
  const windows = platform === 'win32' ? {
    SystemRoot: 'C:\\Windows',
    WINDIR: 'C:\\Windows',
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
  } : { TMPDIR: temp };
  return {
    ...windows,
    PATH: [api.dirname(execPath), ...(platform === 'win32' ? ['C:\\Windows\\System32', 'C:\\Windows'] : ['/usr/bin', '/bin'])].join(api.delimiter),
    TEMP: temp,
    TMP: temp,
    NODE_ENV: mode,
    NEXT_TELEMETRY_DISABLED: '1',
    CI: '1',
    TZ: 'UTC',
    LANG: 'en_US.UTF-8',
    NODE_OPTIONS: '--require=' + JSON.stringify(platform === 'win32' ? preloadPath.replace(/\\/g, '/') : preloadPath),
  };
}

/** Deliberately constructed values. Never inspect or spread the host environment. */
function cleanEnv(mode = 'test') {
  return buildSyntheticEnvironment({ platform: process.platform, root: ROOT,
    execPath: process.execPath, preloadPath: __filename, mode });
}

let tsHook;
function installTsHook(root = ROOT) {
  root = path.resolve(root);
  if (tsHook) {
    if (tsHook.root !== root) throw new Error('The TypeScript hook already belongs to another root.');
    return tsHook.restore;
  }
  const requireAtRoot = Module.createRequire(path.join(root, 'package.json'));
  const ts = requireAtRoot('typescript');
  const originalResolve = Module._resolveFilename;
  const previous = new Map(['.ts', '.tsx'].map(ext => [ext, require.extensions[ext]]));
  Module._resolveFilename = function (request, parent, ...rest) {
    const target = typeof request === 'string' && request.startsWith('@/')
      ? path.join(root, request.slice(2)) : request;
    return originalResolve.call(this, target, parent, ...rest);
  };
  for (const ext of ['.ts', '.tsx']) {
    require.extensions[ext] = function (module, filename) {
      const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
        },
      });
      module._compile(result.outputText, filename);
    };
  }
  const restore = () => {
    Module._resolveFilename = originalResolve;
    for (const [ext, prior] of previous) {
      if (prior) require.extensions[ext] = prior;
      else delete require.extensions[ext];
    }
    tsHook = undefined;
  };
  tsHook = { root, restore };
  return restore;
}

const GUARD_PROBES = Object.freeze(['fetch', 'node:http.request', 'node:https.request', 'net.connect', 'tls.connect', 'dns.lookup', 'dgram.createSocket']);
let networkAudit;
function installNetworkGuard({ expectedDeniedOperations = null } = {}) {
  if (networkAudit) return networkAudit;
  const denied = [];
  const expected = expectedDeniedOperations === null ? [] : [...expectedDeniedOperations];
  const policySatisfied = () => denied.length === expected.length && denied.every((operation, index) => operation === expected[index]);
  const block = operation => {
    denied.push(operation);
    // Log before throwing: a caller may catch the error or terminate this worker
    // with SIGINT, neither of which may erase the parent's blocked-call evidence.
    writeAuditSync(2, '\n' + BLOCK_EVENT_PREFIX + JSON.stringify({ pid: process.pid, ppid: process.ppid, threadId, operation }) + '\n');
    const error = new Error('MIRAE_PIPELINE_NETWORK_BLOCKED: ' + operation);
    error.code = 'MIRAE_PIPELINE_NETWORK_BLOCKED';
    throw error;
  };
  function wrap(target, name, operation) {
    if (!target || typeof target[name] !== 'function') return;
    target[name] = function () { return block(operation); };
  }
  // No localhost exceptions: this runner never starts a server or browser.
  wrap(globalThis, 'fetch', 'fetch');
  for (const protocol of ['node:http', 'node:https']) {
    const client = require(protocol);
    wrap(client, 'request', protocol + '.request');
    wrap(client, 'get', protocol + '.get');
  }
  const net = require('node:net');
  wrap(net, 'connect', 'net.connect');
  wrap(net, 'createConnection', 'net.createConnection');
  wrap(net.Socket.prototype, 'connect', 'Socket.connect');
  wrap(net.Server.prototype, 'listen', 'Server.listen');
  wrap(require('node:tls'), 'connect', 'tls.connect');
  const dns = require('node:dns');
  const methods = Object.keys(dns).filter(name => name === 'lookup' || name === 'lookupService' || name === 'reverse' || name.startsWith('resolve'));
  for (const name of methods) {
    wrap(dns, name, 'dns.' + name);
    wrap(dns.promises, name, 'dns.promises.' + name);
    if (dns.Resolver) wrap(dns.Resolver.prototype, name, 'dns.Resolver.' + name);
    if (dns.promises.Resolver) wrap(dns.promises.Resolver.prototype, name, 'dns.promises.Resolver.' + name);
  }
  wrap(require('node:dgram'), 'createSocket', 'dgram.createSocket');
  Module.syncBuiltinESMExports();
  networkAudit = {
    get attempts() { return denied.length; },
    get operations() { return [...denied]; },
    assertNoAttempts() {
      if (denied.length) throw new Error(denied.length + ' network operation(s) were blocked: ' + denied.join(', '));
    },
    report() { return { allowLoopback: false, attempts: denied.length, expectedTestBlocks: expected.length, operations: [...denied], policySatisfied: policySatisfied() }; },
  };
  process.once('exit', () => {
    fs.writeSync(2, '\nMIRAE_PIPELINE_NETWORK_ATTEMPTS=' + denied.length + '\n');
    if (expected.length) fs.writeSync(2, 'MIRAE_PIPELINE_EXPECTED_TEST_BLOCKS=' + expected.length + '\n');
    if (!policySatisfied()) process.exitCode = 1;
  });
  return networkAudit;
}

function getNetworkAudit() { return networkAudit; }

let guardReadyReported = false;
function reportGuardReady(installation) {
  if (guardReadyReported) return;
  if (!fileGuards || !networkAudit) throw new Error('Both guards must be installed before the ready marker.');
  writeAuditSync(2, '\n' + READY_EVENT_PREFIX + JSON.stringify({ pid: process.pid, ppid: process.ppid, threadId, installation }) + '\n');
  guardReadyReported = true;
}

/** Parent-side evidence survives missing child exit hooks. No host environment is inspected. */
function summarizeWorkerAudit(stdout, stderr, allowGuardSelfTest = false) {
  const ready = [];
  const blocks = [];
  const errors = [];
  // Node's test runner may prefix child stderr with "# ". Match our distinctive
  // marker anywhere on a line, in BOTH captured streams, without depending on TAP.
  for (const stream of [String(stdout || ''), String(stderr || '')]) {
    for (const line of stream.split(/\r?\n/)) {
      for (const [prefix, events] of [[READY_EVENT_PREFIX, ready], [BLOCK_EVENT_PREFIX, blocks]]) {
        const position = line.indexOf(prefix);
        if (position === -1) continue;
        try {
          const event = JSON.parse(line.slice(position + prefix.length));
          const validIdentity = Number.isInteger(event.pid) && event.pid > 0
            && Number.isInteger(event.ppid) && event.ppid > 0
            && Number.isInteger(event.threadId) && event.threadId >= 0;
          const validPayload = prefix === READY_EVENT_PREFIX
            ? ['preload', 'worker'].includes(event.installation)
            : typeof event.operation === 'string' && /^[A-Za-z0-9_.:]{1,80}$/.test(event.operation);
          if (!validIdentity || !validPayload) throw new Error('Invalid audit event');
          events.push(event);
        } catch { errors.push('malformed_guard_event'); }
      }
    }
  }
  if (!ready.length) errors.push('missing_guard_ready_marker');
  const key = event => `${event.pid}:${event.threadId}`;
  const readyKeys = new Set(ready.map(key));
  if (blocks.some(event => !readyKeys.has(key(event)))) errors.push('block_without_ready_marker');
  if (allowGuardSelfTest) {
    // The exception belongs only to the explicit self-test worker, not to build,
    // unit, typecheck, or lint commands, even if a child claims it is a self-test.
    const singleWorker = ready.length === 1 && ready[0].installation === 'worker';
    if (!singleWorker || blocks.length !== GUARD_PROBES.length
      || blocks.some((event, index) => event.operation !== GUARD_PROBES[index] || key(event) !== key(ready[0]))) {
      errors.push('self_test_block_sequence_mismatch');
    }
  } else if (blocks.length) errors.push('unexpected_network_block');
  const contexts = [...new Map(ready.map(event => [key(event), event])).values()];
  return { passed: errors.length === 0, networkBlockEvents: blocks.length,
    expectedSelfTestBlocks: allowGuardSelfTest ? GUARD_PROBES.length : 0,
    readyContextCount: contexts.length,
    preloadContextCount: contexts.filter(event => event.installation === 'preload').length,
    readyContexts: contexts, errors };
}

/** Deliberately denied probes in a fake-environment child; none reach a service or file. */
function runGuardSelfTest() {
  const assert = require('node:assert/strict');
  const environment = cleanEnv();
  assert.deepEqual(Object.keys(environment).sort(), [...(process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'] : ['TMPDIR']),
  'PATH', 'TEMP', 'TMP', 'NODE_ENV', 'NEXT_TELEMETRY_DISABLED', 'CI', 'TZ', 'LANG', 'NODE_OPTIONS'].sort());
  assert.equal(environment.NODE_ENV, 'test');
  assert.ok(environment.NODE_OPTIONS.includes(__filename.replace(/\\/g, '/')));
  const guards = installFileGuards();
  const priorBlockedReads = guards.envReadsBlocked;
  assert.throws(() => fs.readFileSync(path.join(ROOT, '.next', '.ENV.synthetic-probe')), { code: 'ENOENT' });
  assert.equal(guards.envReadsBlocked, priorBlockedReads + 1);
  assert.throws(() => fs.writeFileSync(path.join(ROOT, 'lib', '__mirae_guard_probe_must_not_exist.ts'), 'MUST_NOT_WRITE'), { code: 'MIRAE_PIPELINE_SOURCE_WRITE_BLOCKED' });
  const probes = [
    () => globalThis.fetch('https://synthetic.invalid/guard-probe'),
    () => require('node:http').request('http://synthetic.invalid/guard-probe'),
    () => require('node:https').request('https://synthetic.invalid/guard-probe'),
    () => require('node:net').connect({ host: 'synthetic.invalid', port: 443 }),
    () => require('node:tls').connect({ host: 'synthetic.invalid', port: 443 }),
    () => require('node:dns').lookup('synthetic.invalid', () => {}),
    () => require('node:dgram').createSocket('udp4'),
  ];
  for (const probe of probes) assert.throws(probe, { code: 'MIRAE_PIPELINE_NETWORK_BLOCKED' });
  const audit = getNetworkAudit().report();
  assert.deepEqual(audit.operations, [...GUARD_PROBES]);
  assert.equal(audit.policySatisfied, true);
  const identity = { pid: 1234, ppid: 123, threadId: 0 };
  const readyLine = READY_EVENT_PREFIX + JSON.stringify({ ...identity, installation: 'worker' });
  const blockLine = operation => BLOCK_EVENT_PREFIX + JSON.stringify({ ...identity, operation });
  const sevenLines = GUARD_PROBES.map(blockLine).join('\n');
  assert.equal(summarizeWorkerAudit('', readyLine).passed, true);
  assert.equal(summarizeWorkerAudit('', readyLine + '\n' + blockLine('fetch')).passed, false);
  assert.equal(summarizeWorkerAudit('# ' + blockLine('fetch'), readyLine).passed, false);
  assert.equal(summarizeWorkerAudit('', readyLine + '\n' + sevenLines, true).passed, true);
  assert.equal(summarizeWorkerAudit('', readyLine + '\n' + [...GUARD_PROBES].reverse().map(blockLine).join('\n'), true).passed, false);
  assert.equal(summarizeWorkerAudit('', readyLine + '\n' + sevenLines + '\n' + blockLine('fetch'), true).passed, false);
  assert.equal(summarizeWorkerAudit('', readyLine + '\n' + BLOCK_EVENT_PREFIX + '{broken').passed, false);
  assert.equal(summarizeWorkerAudit('', '').passed, false);
  console.log(JSON.stringify({ mode: 'guard-self-test', passed: true, syntheticEnvironmentKeys: Object.keys(environment).length, envReadsBlocked: guards.envReadsBlocked - priorBlockedReads, sourceWritesBlocked: 1, intentionalNetworkBlocks: audit.attempts, parentAuditCases: 8, applicationNetworkOperations: 0, isolation: 'Node-process guards only; not OS isolation' }));
}

function resolveGuardPath(value, { platform = process.platform, root = ROOT, cwd = root } = {}) {
  try {
    const api = platformPaths(platform);
    if (![root, cwd].every(base => typeof base === 'string' && api.isAbsolute(base)
      && !/[\x00-\x1f\x7f]/.test(base) && (platform !== 'win32' || /^[a-z]:[\\/]/i.test(base)))) return null;
    if (value instanceof URL) {
      if (value.protocol !== 'file:' || value.hostname || value.search || value.hash) return null;
      value = require('node:url').fileURLToPath(value, { windows: platform === 'win32' });
    }
    if (Buffer.isBuffer(value)) value = value.toString('utf8');
    if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) return null;
    // Reject device/UNC paths, drive-relative paths and alternate data streams.
    if (platform === 'win32' && (/^[\\/]{2}/.test(value)
      || /^[a-z]:(?![\\/])/i.test(value) || value.replace(/^[a-z]:/i, '').includes(':'))) return null;
    return api.resolve(cwd, value);
  } catch { return null; }
}

/** Unsupported read paths are denied, never treated as non-environment files. */
function resolveGuardReadPath(value, context = {}) {
  const { platform = process.platform } = context;
  const file = resolveGuardPath(value, context);
  if (!file) return null;
  const parts = file.split(platformPaths(platform).sep);
  if (parts.some(part => /^\.env(?:\..*)?$/i.test(part))) return null;
  if (platform === 'win32' && parts.some(part => /[. ]$/.test(part))) return null;
  return file;
}

/** Pure path predicate for dry-run checks; this function never mutates a file. */
function isAllowedGeneratedWrite(value, operation = 'write', context = {}) {
  const { platform = process.platform, root = ROOT, cwd = root } = context;
  const file = resolveGuardPath(value, { platform, root, cwd });
  if (!file || ['link', 'linkSync', 'symlink', 'symlinkSync'].includes(operation)) return false;
  const api = platformPaths(platform);
  const relative = api.relative(api.resolve(root), file);
  if (!relative || api.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + api.sep)) return false;
  const parts = relative.split(api.sep);
  if (parts.some(part => /^\.env(?:\..*)?$/i.test(part))) return false;
  if (platform === 'win32' && parts.some(part => /[. ]$/.test(part))) return false;
  const normalized = platform === 'win32' ? relative.toLowerCase() : relative;
  if (normalized.startsWith('.next' + api.sep)) return true;
  // Next may create its generated directory, but may not remove or rename it.
  if (normalized === '.next' && (operation === 'mkdir' || operation === 'mkdirSync')) return true;
  // Only Next's generated declaration may be written outside .next; never deleted/moved.
  return normalized === 'next-env.d.ts'
    && ['write', 'writeFile', 'writeFileSync'].includes(operation);
}

const inspectPath = fs.lstatSync.bind(fs);
const canonicalPath = fs.realpathSync.bind(fs);

/** Metadata-only check. Links are denied, including links within the allowed tree.
 * This narrows accidental writes; it does not solve TOCTOU or native/FD bypasses.
 * Fake inspectors let portability tests exercise this without creating any files.
 */
function hasSafeWriteAncestors(value, { platform = process.platform, root = ROOT, cwd = root,
  lstat = inspectPath, realpath = canonicalPath } = {}) {
  const api = platformPaths(platform);
  const file = resolveGuardPath(value, { platform, root, cwd });
  if (!file) return false;
  const normalize = input => platform === 'win32' ? api.resolve(input).toLowerCase() : api.resolve(input);
  const base = api.resolve(root), relative = api.relative(base, file);
  if (api.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + api.sep)) return false;
  for (let current = file; ; current = api.dirname(current)) {
    let exists = false;
    try {
      const stat = lstat(current);
      exists = true;
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)
        || (current !== file && !stat.isDirectory())) return false;
      if (normalize(realpath(current)) !== normalize(current)) return false;
    } catch (error) {
      // Only a missing entry is a possible new output. Unreadable/broken entries fail closed.
      if (exists || !error || error.code !== 'ENOENT') return false;
    }
    if (normalize(current) === normalize(base)) return exists;
  }
}

function validateGuardPaths() {
  const cases = [
    ['workspace root', ROOT, 'rm', false],
    ['source directory', path.join(ROOT, 'app'), 'rename', false],
    ['library directory', path.join(ROOT, 'lib'), 'rm', false],
    ['shared dependencies', path.join(ROOT, 'node_modules'), 'rm', false],
    ['unlisted output', path.join(ROOT, 'report.json'), 'write', false],
    ['package manifest', path.join(ROOT, 'package.json'), 'write', false],
    ['compiler config', path.join(ROOT, 'tsconfig.json'), 'write', false],
    ['generated descendant', path.join(ROOT, '.next', 'server', 'page.js'), 'write', true],
    ['generated subtree', path.join(ROOT, '.next', 'cache'), 'rm', true],
    ['generated root removal', path.join(ROOT, '.next'), 'rm', false],
    ['generated root creation', path.join(ROOT, '.next'), 'mkdir', true],
    ['prefix collision', path.join(ROOT, '.next-other', 'file'), 'write', false],
    ['normalized escape', path.join(ROOT, '.next', '..', 'app'), 'rm', false],
    ['environment inside output', path.join(ROOT, '.next', '.env.production'), 'write', false],
    ['owned generated declaration', path.join(ROOT, 'next-env.d.ts'), 'write', true],
    ['generated declaration removal', path.join(ROOT, 'next-env.d.ts'), 'rm', false],
    ['generated declaration rename', path.join(ROOT, 'next-env.d.ts'), 'rename', false],
    ['uppercase environment', path.join(ROOT, '.next', '.ENV.production'), 'write', false],
    ['outside declaration', path.join(path.dirname(ROOT), 'next-env.d.ts'), 'write', false],
    ['unresolved descriptor', 42, 'write', false],
  ];
  return cases.map(([name, value, operation, expected]) => {
    const actual = isAllowedGeneratedWrite(value, operation);
    return { name, expected, actual, passed: actual === expected };
  });
}

/** Both OS rules run on the current host using only invented inputs/metadata.
 * Passing this suite is NOT a native Linux install, build, or operating-system audit.
 */
function validatePortability() {
  const assert = require('node:assert/strict');
  const checks = [];
  const check = (name, exercise) => {
    try { exercise(); checks.push({ name, passed: true }); }
    catch (error) { checks.push({ name, passed: false, error: error.message }); }
  };
  for (const platform of ['win32', 'linux']) {
    const api = platformPaths(platform);
    const root = platform === 'win32' ? 'C:\\synthetic\\합성 작업' : '/tmp/synthetic/합성 작업';
    const execPath = platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/opt/synthetic node/bin/node';
    const preloadPath = api.join(root, 'scripts', 'test-mirae-pipeline.cjs');
    const context = { platform, root };
    const input = { ...context, execPath, preloadPath };
    const at = (...parts) => api.join(root, ...parts);
    const temp = at('.next', 'tmp');
    for (const mode of ['test', 'production']) {
      check(platform + ': exact ' + mode + ' environment, no inherited credentials', () => {
        const result = buildSyntheticEnvironment({ ...input, mode, inheritedEnvironment: { DATABASE_URL: 'MUST_NOT_COPY', NODE_OPTIONS: '--eval=DO_NOT_RUN' } });
        const expected = {
          ...(platform === 'win32' ? { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', COMSPEC: 'C:\\Windows\\System32\\cmd.exe', PATHEXT: '.COM;.EXE;.BAT;.CMD' } : { TMPDIR: temp }),
          PATH: platform === 'win32' ? 'C:\\Program Files\\nodejs;C:\\Windows\\System32;C:\\Windows' : '/opt/synthetic node/bin:/usr/bin:/bin',
          TEMP: temp, TMP: temp, NODE_ENV: mode, NEXT_TELEMETRY_DISABLED: '1', CI: '1', TZ: 'UTC', LANG: 'en_US.UTF-8',
          NODE_OPTIONS: platform === 'win32'
            ? '--require="C:/synthetic/합성 작업/scripts/test-mirae-pipeline.cjs"'
            : '--require="/tmp/synthetic/합성 작업/scripts/test-mirae-pipeline.cjs"',
        };
        assert.deepEqual(result, expected);
        result.PATH = 'mutated';
        assert.equal(buildSyntheticEnvironment({ ...input, mode }).PATH, expected.PATH);
      });
    }
    for (const field of ['root', 'execPath', 'preloadPath']) {
      for (const bad of ['relative/path', 'bad\u0000path', 'bad\npath', at('bad" --eval=x')]) {
        check(platform + ': reject unsafe ' + field + ' ' + JSON.stringify(bad), () => {
          assert.throws(() => buildSyntheticEnvironment({ ...input, [field]: bad }));
        });
      }
    }
    check(platform + ': reject outside preload and unknown mode', () => {
      assert.throws(() => buildSyntheticEnvironment({ ...input, preloadPath: at('other.cjs') }));
      assert.throws(() => buildSyntheticEnvironment({ ...input, mode: 'live' }));
    });
    const output = at('.next', 'cache', 'example.json');
    const fileUrl = new URL(platform === 'win32'
      ? 'file:///C:/synthetic/%E5%90%88%E6%88%90/.next/cache.json'
      : 'file:///tmp/synthetic/%E5%90%88%E6%88%90/.next/cache.json');
    const urlRoot = platform === 'win32' ? 'C:\\synthetic\\合成' : '/tmp/synthetic/合成';
    const pathCases = [
      ['normal generated file', output, 'write', true],
      ['buffer path', Buffer.from(output), 'write', true],
      ['relative output', '.next/cache/file', 'write', true],
      ['root cannot be removed', root, 'rm', false],
      ['source cannot be written', at('lib', 'source.ts'), 'write', false],
      ['dependencies cannot be removed', at('node_modules'), 'rm', false],
      ['generated root creation', at('.next'), 'mkdir', true],
      ['generated root removal', at('.next'), 'rm', false],
      ['generated root rename', at('.next'), 'rename', false],
      ['prefix collision', at('.next-other', 'file'), 'write', false],
      ['parent escape', at('.next', '..', 'lib', 'file'), 'write', false],
      ['outside sibling', api.join(api.dirname(root), 'another', '.next', 'file'), 'write', false],
      ['uppercase generated dir', at('.NEXT', 'file'), 'write', platform === 'win32'],
      ['case-different ancestor', root.replace('synthetic', 'SYNTHETIC') + api.sep + '.next' + api.sep + 'file', 'write', platform === 'win32'],
      ['declaration write', at('next-env.d.ts'), 'writeFile', true],
      ['declaration delete', at('next-env.d.ts'), 'rm', false],
      ['declaration rename', at('next-env.d.ts'), 'rename', false],
      ['uppercase declaration', at('NEXT-ENV.D.TS'), 'write', platform === 'win32'],
      ['environment file', at('.next', '.env.local'), 'write', false],
      ['uppercase environment', at('.next', '.ENV.production'), 'write', false],
      ['environment-named ancestor', at('.next', '.env.local', 'file'), 'write', false],
      ['symlink creation', output, 'symlink', false],
      ['hardlink creation', output, 'linkSync', false],
      ['numeric descriptor', 42, 'write', false],
      ['empty path', '', 'write', false],
      ['NUL path', output + '\u0000', 'write', false],
      ['non-file URL', new URL('https://synthetic.invalid/file'), 'write', false],
      ['remote file URL', new URL('file://synthetic.invalid/share/file'), 'write', false],
      ['file URL query', new URL(fileUrl.href + '?unsafe=1'), 'write', false],
    ];
    for (const [name, value, operation, expected] of pathCases) {
      check(platform + ': ' + name, () => assert.equal(isAllowedGeneratedWrite(value, operation, context), expected));
    }
    check(platform + ': platform-specific file URL', () => {
      assert.equal(isAllowedGeneratedWrite(fileUrl, 'write', { platform, root: urlRoot }), true);
    });
    check(platform + ': relative writes follow injected working directory', () => {
      assert.equal(isAllowedGeneratedWrite('.next/probe', 'write', { ...context, cwd: root }), true);
      assert.equal(isAllowedGeneratedWrite('.next/probe', 'write', { ...context, cwd: api.dirname(root) }), false);
      assert.equal(isAllowedGeneratedWrite(output, 'write', { ...context, cwd: api.dirname(root) }), true);
      const inspected = resolveGuardPath('.next/probe', { ...context, cwd: root });
      assert.equal(inspected, at('.next', 'probe'));
      // Runtime wrappers pass this absolute path, even if cwd later changes.
      assert.equal(resolveGuardPath(inspected, { ...context, cwd: api.dirname(root) }), inspected);
      assert.equal(resolveGuardPath('.env.local', { ...context, cwd: api.dirname(root) }), api.join(api.dirname(root), '.env.local'));
    });
    const readCases = [
      ['ordinary source', at('lib', 'source.ts'), at('lib', 'source.ts')],
      ['relative source', 'lib/source.ts', at('lib', 'source.ts')],
      ['buffer source', Buffer.from(at('lib', 'source.ts')), at('lib', 'source.ts')],
      ['environment file', at('.env.local'), null],
      ['uppercase environment', at('.ENV.production'), null],
      ['environment ancestor', at('.env.local', 'file'), null],
      ['relative environment', '.env.local', null],
      ['descriptor', 42, null],
      ['empty', '', null],
      ['NUL', 'bad\u0000path', null],
      ['remote file URL', new URL('file://synthetic.invalid/share/.env.local'), null],
    ];
    if (platform === 'win32') readCases.push(
      ['drive-relative environment', 'C:.env.local', null],
      ['extended environment', '\\\\?\\C:\\synthetic\\.env.local', null],
      ['UNC environment', '\\\\synthetic.invalid\\share\\.env.local', null],
      ['stream environment', at('.env.local') + ':stream', null],
      ['trailing dot environment', at('.env.'), null],
      ['trailing space environment', at('.env '), null],
    );
    for (const [name, value, expected] of readCases) {
      check(platform + ': guarded read ' + name, () => assert.equal(resolveGuardReadPath(value, context), expected));
    }
    check(platform + ': guarded reads follow injected working directory', () => {
      assert.equal(resolveGuardReadPath('lib/source.ts', { ...context, cwd: api.dirname(root) }), api.join(api.dirname(root), 'lib', 'source.ts'));
      assert.equal(resolveGuardReadPath('.env.local', { ...context, cwd: api.dirname(root) }), null);
    });
    if (platform === 'win32') {
      for (const value of ['C:relative', '\\\\server\\share\\file', output + ':stream', at('.next', 'unsafe.')]) {
        check('win32: reject ambiguous/device/stream path ' + value, () => assert.equal(isAllowedGeneratedWrite(value, 'write', context), false));
      }
    }
    // Invented directory entries: no real lstat/realpath, link creation or filesystem writes.
    const normalStat = { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, nlink: 1 };
    const fake = { ...context, lstat: () => normalStat, realpath: value => value };
    check(platform + ': safe metadata ancestors', () => assert.equal(hasSafeWriteAncestors(output, fake), true));
    for (const target of [root, at('.next'), at('.next', 'cache'), output, at('next-env.d.ts')]) {
      check(platform + ': reject existing symlink ' + target, () => {
        assert.equal(hasSafeWriteAncestors(target === at('next-env.d.ts') ? target : output, {
          ...fake, lstat: value => value === target ? { ...normalStat, isSymbolicLink: () => true } : normalStat,
        }), false);
      });
    }
    check(platform + ': reject hardlinked file and redirected real path', () => {
      assert.equal(hasSafeWriteAncestors(output, { ...fake,
        lstat: value => value === output ? { ...normalStat, isFile: () => true, isDirectory: () => false, nlink: 2 } : normalStat,
      }), false);
      assert.equal(hasSafeWriteAncestors(output, { ...fake, realpath: () => api.join(api.dirname(root), 'original') }), false);
    });
    const missing = () => { const error = new Error('Synthetic missing entry'); error.code = 'ENOENT'; throw error; };
    check(platform + ': new output under existing safe root', () => {
      assert.equal(hasSafeWriteAncestors(output, { ...fake, lstat: value => value === root ? normalStat : missing() }), true);
      assert.equal(hasSafeWriteAncestors(output, { ...fake, lstat: missing }), false);
    });
    for (const code of ['EACCES', 'ELOOP', 'ENOTDIR']) {
      check(platform + ': metadata failure ' + code, () => {
        const failure = () => { const error = new Error('Synthetic metadata error'); error.code = code; throw error; };
        assert.equal(hasSafeWriteAncestors(output, { ...fake, lstat: failure }), false);
        assert.equal(hasSafeWriteAncestors(output, { ...fake, realpath: failure }), false);
      });
    }
    check(platform + ': broken existing path is not a new entry', () => {
      assert.equal(hasSafeWriteAncestors(output, { ...fake, realpath: missing }), false);
    });
  }
  check('unsupported platform fails closed', () => {
    assert.throws(() => buildSyntheticEnvironment({ platform: 'unsupported' }));
    assert.equal(isAllowedGeneratedWrite('/tmp/file', 'write', { platform: 'unsupported', root: '/tmp' }), false);
  });
  check('fixed regression scope does not replace unit scope', () => {
    assert.equal(REGRESSION_FILES.length, 8);
    assert.equal(new Set(REGRESSION_FILES).size, 8);
    assert.equal(UNIT_FILES.length, 4);
    assert.ok(REGRESSION_FILES.every(file => !SOURCE_FILES.includes(file)));
  });
  check('reviewed eight-test manifest only; no six-test or added-command bypass', () => {
    const expected = 'npx --yes tsx --test ' + REGRESSION_FILES.join(' ');
    assert.equal(matchesRegressionManifest({ scripts: { test: expected } }), true);
    assert.equal(matchesRegressionManifest({ scripts: { test: 'npx --yes tsx --test ' + REGRESSION_FILES.slice(0, 6).join(' ') } }), false);
    assert.equal(matchesRegressionManifest({ scripts: { test: expected + ' && npm install' } }), false);
    assert.equal(matchesRegressionManifest({ scripts: { test: expected.replace('portfolioReturn.test.ts', 'unreviewed.test.ts') } }), false);
    assert.equal(matchesRegressionManifest({}), false);
    assert.equal(matchesRegressionManifest(null), false);
  });
  return checks;
}

let fileGuards;
function installFileGuards(root = ROOT) {
  root = path.resolve(root);
  if (root !== ROOT) throw new Error('File guards support only this explicitly approved isolated worktree.');
  if (fileGuards) return fileGuards;
  // The approved isolated ROOT had no next-env.d.ts at baseline. Subsequent
  // Next workers may see the generated file and may regenerate that artifact.
  let envReadsBlocked = 0;
  const filename = value => resolveGuardPath(value, { root, cwd: process.cwd() });
  function absentEnv(value) {
    envReadsBlocked += 1;
    const error = new Error('Environment files are unavailable to this verification worker.');
    error.code = 'ENOENT';
    error.path = filename(value);
    return error;
  }
  function checkRead(value) {
    const file = resolveGuardReadPath(value, { root, cwd: process.cwd() });
    if (!file) throw absentEnv(value);
    return file;
  }
  function checkWrite(value, operation = 'write') {
    const file = filename(value);
    if (file && isAllowedGeneratedWrite(file, operation) && hasSafeWriteAncestors(file)) return file;
    const error = new Error(`MIRAE_PIPELINE_SOURCE_WRITE_BLOCKED: ${operation}`);
    error.code = 'MIRAE_PIPELINE_SOURCE_WRITE_BLOCKED';
    throw error;
  }
  const readSync = fs.readFileSync;
  fs.readFileSync = function (value, ...args) { return readSync.call(this, checkRead(value), ...args); };
  const read = fs.readFile;
  fs.readFile = function (value, ...args) {
    let file;
    try { file = checkRead(value); }
    catch (error) {
      const callback = args[args.length - 1];
      if (typeof callback !== 'function') throw error;
      queueMicrotask(() => callback(error));
      return;
    }
    return read.call(this, file, ...args);
  };
  const readPromise = fs.promises.readFile;
  fs.promises.readFile = async function (value, ...args) { return readPromise.call(this, checkRead(value), ...args); };
  const readStream = fs.createReadStream;
  fs.createReadStream = function (value, ...args) { return readStream.call(this, checkRead(value), ...args); };
  for (const owner of [fs, fs.promises]) {
    for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'truncate', 'truncateSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'lchmod', 'lchmodSync', 'lchown', 'lchownSync', 'utimes', 'utimesSync', 'lutimes', 'lutimesSync']) {
      if (typeof owner[name] !== 'function') continue;
      const original = owner[name];
      owner[name] = function (value, ...args) { return original.call(this, checkWrite(value, name), ...args); };
    }
    for (const name of ['rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'link', 'linkSync', 'symlink', 'symlinkSync']) {
      if (typeof owner[name] !== 'function') continue;
      const original = owner[name];
      owner[name] = function (from, to, ...args) {
        const target = checkWrite(to, name);
        const readableSource = checkRead(from);
        const source = name.startsWith('rename') || name.startsWith('cp') || name.startsWith('link')
          ? checkWrite(readableSource, name) : readableSource;
        return original.call(this, source, target, ...args);
      };
    }
    for (const name of ['open', 'openSync']) {
      if (typeof owner[name] !== 'function') continue;
      const original = owner[name];
      owner[name] = function (value, flags, ...args) {
        const readablePath = checkRead(value);
        const writing = typeof flags === 'string' ? /[wa+]/.test(flags) : Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND));
        return original.call(this, writing ? checkWrite(readablePath) : readablePath, flags, ...args);
      };
    }
  }
  Module.syncBuiltinESMExports();
  fileGuards = { get envReadsBlocked() { return envReadsBlocked; } };
  return fileGuards;
}

function requireFiles(files) {
  for (const file of files) if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`Missing local verification input: ${file}`);
  return files.map(file => path.join(ROOT, file));
}

function matchesRegressionManifest(manifest) {
  const expected = 'npx --yes tsx --test ' + REGRESSION_FILES.join(' ');
  return Boolean(manifest && manifest.scripts && manifest.scripts.test === expected);
}

function requireRegressionFiles() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (!matchesRegressionManifest(manifest)) {
    throw new Error('Regression manifest mismatch: expected the eight tests reviewed at e15cf48d; zero regression tests executed. Stop and review scope.');
  }
  // Read the manifest only; never execute npm/npx or install a missing dependency.
  return requireFiles(REGRESSION_FILES);
}

function typecheck(all) {
  const ts = localRequire('typescript');
  const config = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT, { noEmit: true, incremental: false });
  const files = all ? parsed.fileNames : requireFiles(SOURCE_FILES);
  const options = { ...parsed.options, incremental: false, noEmit: true, tsBuildInfoFile: undefined };
  const program = ts.createProgram(files, options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => ROOT, getCanonicalFileName: file => file, getNewLine: () => '\n',
  }));
  console.log(JSON.stringify({ mode: all ? 'types-all' : 'types', entryFiles: files.length, diagnostics: diagnostics.length, noEmit: true }));
  process.exitCode = diagnostics.length ? 1 : 0;
}

function spawnWorker(args, mode = 'test', timeout = 300000) {
  const environment = cleanEnv(mode);
  // Preloading the entry file itself caches it before Node can execute its main.
  // Our explicit worker branch installs guards and never launches descendants.
  if (args[0] === __filename) delete environment.NODE_OPTIONS;
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT, env: environment, encoding: 'utf8', timeout,
    maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);
  if (result.signal) console.error(`Worker terminated by ${result.signal}`);
  const allowGuardSelfTest = mode === 'test' && args.length === 3
    && args[0] === __filename && args[1] === 'worker' && args[2] === 'guard-self-test';
  const audit = summarizeWorkerAudit(result.stdout, result.stderr, allowGuardSelfTest);
  const passed = result.status === 0 && !result.error && !result.signal && audit.passed;
  console.log(JSON.stringify({ mode: 'parent-worker-audit', workerPid: result.pid,
    workerExit: result.status, ...audit,
    descendantGuardContextCount: audit.readyContexts.filter(event => event.pid !== result.pid || event.threadId !== 0).length,
    passed }));
  process.exitCode = passed ? 0 : 1;
  return result;
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'guard-paths') {
    const checks = validateGuardPaths();
    console.log(JSON.stringify({ mode, dryRun: true, checks, passed: checks.every(check => check.passed) }));
    process.exitCode = checks.every(check => check.passed) ? 0 : 1;
    return;
  }
  if (mode === 'worker') {
    installFileGuards();
    const action = process.argv[3];
    installNetworkGuard(action === 'guard-self-test' ? { expectedDeniedOperations: GUARD_PROBES } : undefined);
    reportGuardReady('worker');
    if (action === 'guard-self-test') return runGuardSelfTest();
    if (action === 'portability') {
      const checks = validatePortability();
      const passed = checks.every(check => check.passed);
      console.log(JSON.stringify({ mode: 'portability', hostPlatform: process.platform,
        simulatedPlatforms: ['win32', 'linux'], actualLinuxValidation: false,
        checks, total: checks.length, passed, filesCreated: 0,
        isolation: 'Node-process guards only; not OS isolation' }));
      process.exitCode = passed ? 0 : 1;
      return;
    }
    if (action === 'types' || action === 'types-all') return typecheck(action === 'types-all');
    throw new Error(`Unknown worker action: ${action}`);
  }
  if (mode === 'unit' || mode === 'regression') {
    const tests = mode === 'regression' ? requireRegressionFiles() : requireFiles(UNIT_FILES);
    if (!tests.length) throw new Error('No test files found.');
    console.log(JSON.stringify({ mode, testFiles: tests.length, environment: 'synthetic', outbound: 'blocked' }));
    return spawnWorker(['--require', __filename, '--test', '--test-concurrency=1', ...tests]);
  }
  if (mode === 'types' || mode === 'types-all' || mode === 'guard-self-test' || mode === 'portability') return spawnWorker([__filename, 'worker', mode]);
  if (mode === 'lint' || mode === 'lint-all' || mode === 'build') {
    // resolve() fails locally if a prerequisite is missing; there is no install fallback.
    for (const name of ['next/package.json', 'typescript/package.json', '@types/react/package.json', '@types/node/package.json']) localRequire.resolve(name);
    if (mode !== 'build') for (const name of ['eslint/package.json', 'eslint-config-next/package.json']) localRequire.resolve(name);
    const next = localRequire.resolve('next/dist/bin/next');
    const args = [next, mode === 'lint-all' ? 'lint' : mode, ROOT];
    if (mode !== 'build') {
      args.push('--no-cache');
      if (mode === 'lint') for (const file of requireFiles(SOURCE_FILES)) args.push('--file', file);
    }
    console.log(JSON.stringify({ mode, environment: 'synthetic', outbound: 'blocked', generatedArtifacts: mode === 'build' ? '.next plus next-env.d.ts only if the framework requires it' : 'none' }));
    return spawnWorker(args, 'production', mode === 'build' ? 600000 : 300000);
  }
  throw new Error('Use guard-paths, guard-self-test, portability, unit, regression, types, types-all, lint, lint-all, or build.');
}

module.exports = { ROOT, SOURCE_FILES, REGRESSION_FILES, installTsHook, buildSyntheticEnvironment,
  cleanEnv, installNetworkGuard, getNetworkAudit, installFileGuards, isAllowedGeneratedWrite,
  hasSafeWriteAncestors, validateGuardPaths, validatePortability };

if (require.main === module) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
} else if (module.parent && module.parent.id === 'internal/preload') {
  installFileGuards();
  installNetworkGuard();
  reportGuardReady('preload');
  if (process.execArgv.includes('--test') || process.argv.some(arg => /\.test\.tsx?$/.test(arg))) installTsHook();
}
