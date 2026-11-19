'use strict';
// Check the ShowTrak QLab network device definition against a built server.
//
//   node qlab/check.js --ndd <showtrak-server.json>[,<more>] --server <built server dir>
//
// Expands every OSC message the definition can send (every menu combination,
// sample values for the free-text fields) and checks each one against the
// server: it matches an OSC route, a Monitor message names a real method/action
// and fills its required parameters the way the server maps OSC arguments
// (positionally, '' meaning "use the default"), and a FreeKiosk message names a
// command on the allowlist and gives it a value when it needs one.
//
// Static on purpose: no Electron, runs in seconds. Delivery over UDP is covered
// by the server's own OSC tests. Exit code 0 when clean, 1 otherwise.
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/util');

const opts = U.parseArgs(process.argv.slice(2), { ndd: null, server: null, verbose: false });
if (!opts.ndd || !opts.server) {
  console.error('usage: node qlab/check.js --ndd <file>[,<file>] --server <built server dir>');
  process.exit(2);
}

// --- What the server accepts -------------------------------------------------
const serverDir = path.resolve(opts.server);
const oscSource = fs.readFileSync(
  path.join(serverDir, 'src', 'Modules', 'OSC', 'index.ts'),
  'utf8'
);
const routes = [...oscSource.matchAll(/CreateRoute\(\s*'([^']+)'/g)].map((m) => m[1]);
const MonitoringMethods = require(
  path.join(serverDir, 'dist', 'Modules', 'MonitoringMethods')
).Manager;
const { FREEKIOSK_COMMANDS } = require(
  path.join(serverDir, 'dist', 'Modules', 'FreeKiosk', 'commands.js')
);
const kioskCommands = new Map(FREEKIOSK_COMMANDS.map((c) => [c.ID, c]));
const serverVersion = JSON.parse(
  fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8')
).version;

const isBlank = (v) => v === undefined || v === null || v === '';

function matchRoutes(address) {
  const parts = address.split('/');
  return routes.filter((r) => {
    const rp = r.split('/');
    return (
      rp.length === parts.length &&
      rp.every((x, i) => x === parts[i] || (x.startsWith(':') && parts[i] !== ''))
    );
  });
}

// The server's positionalParams(): the error it would raise, or null.
function monitorParamsError(fields, values) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const lastList = f.Type === 'list' && i === fields.length - 1;
    const has = lastList ? values.slice(i).some((v) => !isBlank(v)) : !isBlank(values[i]);
    if (f.Required && !has && isBlank(f.Default))
      return `needs a value for ${f.Label || f.Key} (value ${i + 1})`;
  }
  return null;
}

// --- Expanding the definition ------------------------------------------------
function evalPredicate(p, env) {
  let m;
  if ((m = p.match(/^(\w+) == '(.*)'$/))) return env[m[1]] === m[2];
  if ((m = p.match(/^(\w+) in \{ (.*) \}$/)))
    return m[2]
      .split(', ')
      .map((s) => s.slice(1, -1))
      .includes(env[m[1]]);
  throw new Error(`unsupported predicate: ${p}`);
}

const SAMPLES = {
  slug: 'e2e-target',
  id: 'e2e-target',
  scriptId: 'scr',
  eventId: 'ev',
  script: 'scr',
};
// The Monitor message takes the check type, action and values as typed-in text.
// Those become placeholders, and each message that has them is repeated for
// every action in the server's catalogue (see forEachMonitorAction).
const TYPED_IN = { method: '@METHOD@', checkAction: '@ACTION@', values: '@VALUES@' };
function sampleFor(p) {
  if (p.hidden) return p.defaultValue ?? '';
  if (TYPED_IN[p.key]) return TYPED_IN[p.key];
  if (p.type === 'scalar') return String(p.defaultValue ?? p.minimum ?? 1);
  if (p.defaultValue !== undefined) return String(p.defaultValue);
  if (SAMPLES[p.key]) return SAMPLES[p.key];
  if (/\[0-9\]/.test(p.pattern || '')) return '2';
  return 'Main Show 1'; // free text with spaces
}

function expand(ndd) {
  const out = [];
  const problems = [];
  const walk = (params, conditions, env, template, vars) => {
    const menus = (params || []).filter((p) => p.type === 'menu');
    const values = { ...vars };
    for (const p of (params || []).filter((x) => x.type !== 'menu')) values[p.key] = sampleFor(p);
    const rec = (i, e) => {
      if (i < menus.length) {
        for (const v of menus[i].values)
          if (v !== '---') rec(i + 1, { ...e, [menus[i].key]: Object.values(v)[0] });
        return;
      }
      const matched = (conditions || []).filter((c) => evalPredicate(c.predicate, e));
      if (!matched.length) {
        if (!template) {
          problems.push(`menu combination with no message: ${JSON.stringify(e)}`);
          return;
        }
        const all = { ...values, ...e };
        try {
          out.push({
            message: template.replace(/\{(\w+)\}/g, (_, k) => {
              if (all[k] === undefined)
                throw new Error(`template ${template} uses {${k}}, which has no value`);
              return all[k];
            }),
            env: e,
          });
        } catch (err) {
          problems.push(err.message);
        }
        return;
      }
      for (const c of matched) walk(c.parameters, c.conditions, e, c.template || template, values);
    };
    rec(0, env);
  };
  walk(ndd.parameters, ndd.conditions, {}, null, { prefix: '/API' });
  return { messages: out, problems };
}

// A value for one action parameter, as an operator would type it into QLab.
function sampleValue(field) {
  if (Array.isArray(field.Options) && field.Options.length) {
    const o = field.Options[0];
    return quoteIfNeeded(String(o && typeof o === 'object' ? (o.Value ?? o.value ?? o.ID) : o));
  }
  if (!isBlank(field.Default)) return quoteIfNeeded(String(field.Default));
  if (field.Type === 'number') return '1';
  if (field.Type === 'boolean') return 'true';
  if (field.Type === 'list') return '"a,b"';
  return '"Main Show"';
}
const quoteIfNeeded = (v) => (/^\S+$/.test(v) ? v : `"${v}"`);

// Expand placeholder messages over the whole Monitor action catalogue. Without
// values, only actions that need none are expected to work; with values, every
// action gets one value per declared parameter, in order.
function forEachMonitorAction(messages) {
  const out = [];
  for (const m of messages) {
    if (!m.message.includes('@METHOD@')) {
      out.push(m);
      continue;
    }
    for (const method of MonitoringMethods.GetAll()) {
      for (const action of method.Actions || []) {
        const fields = Array.isArray(action.Params) ? action.Params : [];
        const withValues = m.message.includes('@VALUES@');
        if (withValues && !fields.length) continue;
        if (!withValues && monitorParamsError(fields, [])) continue;
        out.push({
          ...m,
          message: m.message
            .replace('@METHOD@', method.ID)
            .replace('@ACTION@', action.ID)
            .replace('@VALUES@', fields.map(sampleValue).join(' ')),
        });
      }
    }
  }
  return out;
}

// QLab-style tokenising: a quoted run is one string, a bare number is a number.
function tokenize(message) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(message))) {
    tokens.push(m[1] !== undefined ? m[1] : /^-?\d+(\.\d+)?$/.test(m[2]) ? Number(m[2]) : m[2]);
  }
  return tokens;
}

function checkMessage(message) {
  const [address, ...args] = tokenize(message);
  const parts = String(address).split('/');
  if (!matchRoutes(address).length) return 'matches no OSC route';
  const monitor = address.match(/^\/API\/Monitor\/[^/]+\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
  if (monitor) {
    const [, method, actionId, pathValue] = monitor;
    const action = MonitoringMethods.GetAction(method, actionId);
    if (!action) return `unknown monitor action ${method}/${actionId}`;
    const fields = Array.isArray(action.Params) ? action.Params : [];
    if (pathValue !== undefined && !fields.length) return `${method}/${actionId} takes no value`;
    const values = fields.length ? (pathValue !== undefined ? [pathValue, ...args] : args) : [];
    const err = monitorParamsError(fields, values);
    if (err) return `${action.Label} ${err}`;
    const extra = values.slice(fields.length).filter((v) => !isBlank(v));
    const lastIsList = fields.length && fields[fields.length - 1].Type === 'list';
    if (extra.length && !lastIsList)
      return `${method}/${actionId} gets ${extra.length} argument(s) it ignores`;
    return null;
  }
  const kiosk = parts.indexOf('FreeKiosk');
  if (kiosk >= 0) {
    // /API/FreeKiosk/<slug>/<cmd>[/<v>] or /API/(Group|Tag)/<slug>/FreeKiosk/<cmd>[/<v>] or /API/All/FreeKiosk/<cmd>[/<v>]
    const afterSlug = parts[kiosk - 1] === 'API' ? kiosk + 2 : kiosk + 1;
    const commandId = parts[afterSlug];
    const pathValue = parts[afterSlug + 1];
    const command = kioskCommands.get(commandId);
    if (!command) return `unknown FreeKiosk command "${commandId}"`;
    const first = Array.isArray(command.Params) ? command.Params[0] : undefined;
    if (pathValue !== undefined && !first) return `${command.Label} takes no value`;
    if (first && pathValue === undefined && isBlank(args[0]))
      return `${command.Label} needs a value`;
    return null;
  }
  return null;
}

let failed = 0;
const summary = [];
for (const file of String(opts.ndd).split(',').filter(Boolean)) {
  const ndd = JSON.parse(fs.readFileSync(file, 'utf8'));
  const label = `${path.basename(file)}${ndd.version ? ` v${ndd.version}` : ''}`;
  const checks = new U.Checks(label);
  const expanded = expand(ndd);
  const problems = expanded.problems;
  const messages = forEachMonitorAction(expanded.messages);
  checks.add(
    'every menu combination produces a message',
    problems.length === 0,
    problems.slice(0, 10)
  );
  const bad = [];
  const used = new Set();
  for (const { message } of messages) {
    const [address] = tokenize(message);
    matchRoutes(address).forEach((r) => used.add(r));
    const err = checkMessage(message);
    if (err) bad.push(`${message}  -> ${err}`);
    else if (opts.verbose) console.log(`    ok  ${message}`);
  }
  checks.add(
    `all ${messages.length} messages are accepted by server ${serverVersion}`,
    bad.length === 0,
    bad.slice(0, 15)
  );
  const uncovered = routes.filter((r) => !used.has(r));
  console.log(
    `  info  [${label}] routes covered ${used.size}/${routes.length}; not offered: ${uncovered.join(', ') || 'none'}`
  );
  failed += checks.failed.length;
  summary.push(
    `- ${label}: ${messages.length} messages, ${bad.length} rejected, ${used.size}/${routes.length} routes offered`
  );
}
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### QLab definition vs server ${serverVersion}\n\n${summary.join('\n')}\n\n`
  );
}
process.exit(failed ? 1 : 0);
