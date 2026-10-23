/**
 * Host half of the Memory Erase Protocol.
 *
 * It owns three things the browser cannot do:
 *  - watch removable media for the one marker file this plugin claims,
 *  - read the displayed Session's token pressure from Host services,
 *  - archive the displayed Session, create its blank successor, and move the
 *    old Session artifact out of the live session root.
 *
 * The browser half talks to it over a plugin-owned same-origin HTTP route.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const name = 'memory-erase';
export const inject = ['webServer'];

/**
 * Defaults for the row knobs. The row `config` block is read defensively in
 * `apply`, so a deployment can change the marker name, poll cadence, trash
 * retention, or the local test trigger without this package depending on the
 * schema library that ships inside the DSH installation.
 */
const DEFAULTS = {
  markerFile: '.dsh-memory-erase.key',
  pollIntervalMs: 1200,
  trashRetentionDays: 7,
  testMode: false,
};

const ROUTE_PREFIX = '/plugin/memory-erase';
const DEFAULT_CONTEXT_WINDOW = 128000;
const WINDOWS_ROOTS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`);
const POSIX_MOUNT_ROOTS = ['/Volumes', '/media', '/run/media', '/mnt'];
const TRASH_DIR_NAME = '.memory-erase-trash';

/** Read one request body with a small bound; these payloads are tiny. */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolvePromise(null);
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('request body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Every place a removable volume can appear as a filesystem root. Windows uses
 * drive letters; macOS mounts under /Volumes, Linux desktops under /media or
 * /run/media. Whatever appears here is only a *location to look in* — no drive
 * letter, label, or serial is ever required or compared.
 */
async function mountRoots() {
  if (process.platform === 'win32') return WINDOWS_ROOTS;
  const roots = [];
  for (const base of POSIX_MOUNT_ROOTS) {
    if (!existsSync(base)) continue;
    try {
      for (const entry of await readdir(base, { withFileTypes: true })) {
        if (entry.isDirectory() || entry.isSymbolicLink()) roots.push(join(base, entry.name));
      }
    } catch {
      // An unreadable mount base just contributes nothing.
    }
  }
  return roots;
}

/** Same escaping rule the JSONL session backend uses for its project directories. */
function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path');
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

function sessionsRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'sessions');
}

export function apply(ctx, config) {
  const settings = { ...DEFAULTS, ...(config ?? {}) };
  const markerFile = typeof settings.markerFile === 'string' && settings.markerFile !== '' ? settings.markerFile : DEFAULTS.markerFile;
  const pollIntervalMs = Math.max(300, Number(settings.pollIntervalMs) || DEFAULTS.pollIntervalMs);
  const trashRetentionDays = Math.max(0, Number(settings.trashRetentionDays) ?? DEFAULTS.trashRetentionDays);
  const testMode = settings.testMode === true;
  const sessionsRootPath = sessionsRoot();

  /**
   * The trash lives *beside* the session root, never inside it. The Host reads
   * every directory under `sessions/` as a project directory and rejects any
   * artifact whose stored cwd disagrees with its location — one archived
   * Session in there used to abort `workspace-registry` and take the whole
   * startup down with it.
   */
  function trashRoot() {
    return join(dirname(sessionsRootPath), TRASH_DIR_NAME);
  }

  /**
   * Builds before 1.0.3 wrote the trash under `sessions/`. Relocate it the
   * moment it appears, because a leftover there is a startup-blocking defect.
   * Nothing is ever deleted: entries are moved, and if something refuses to
   * move it is kept under a quarantine name outside the scanned root.
   */
  async function migrateLegacyTrash() {
    const legacy = join(sessionsRootPath, TRASH_DIR_NAME);
    if (!existsSync(legacy)) return;
    const target = trashRoot();
    try {
      if (!existsSync(target)) {
        await rename(legacy, target);
        return;
      }
      await mkdir(target, { recursive: true });
      let movedAll = true;
      for (const entry of await readdir(legacy)) {
        try {
          await rename(join(legacy, entry), join(target, entry));
        } catch {
          movedAll = false;
        }
      }
      if (movedAll) {
        await rm(legacy, { recursive: true, force: true });
        return;
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await rename(legacy, join(dirname(sessionsRootPath), `${TRASH_DIR_NAME}-quarantine-${stamp}`));
    } catch {
      // A locked or read-only home must never block plugin activation.
    }
  }

  void migrateLegacyTrash();

  /**
   * Durable breadcrumb for the destructive path only: which Session the
   * confirmation actually resolved to, what artifact it found, and how the
   * erase ended. Kept bounded and JSONL so a failed run can be audited.
   */
  async function audit(entry) {
    try {
      const dir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'logs');
      await mkdir(dir, { recursive: true });
      await appendFile(
        join(dir, 'memory-erase-audit.jsonl'),
        `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`,
        'utf8',
      );
    } catch {
      // Auditing never blocks the operation.
    }
  }

  /** The currently mounted marker drive, or null. */
  let present = null;
  /** One prompt per mount: `{ digest, since, acknowledgedAt, details }`. */
  let pending = null;
  /**
   * Digest of the medium whose deletion already completed. Until that medium is
   * removed and reconnected, the prompt stays down — including across a page
   * refresh or the blank successor Session the erase created.
   */
  let suppressedDigest = null;
  let lastScanAt = 0;

  function markerDigest(drive, raw, markerPath) {
    return createHash('sha256')
      .update(`${drive.toUpperCase()}|${markerPath}|${raw}`)
      .digest('hex')
      .slice(0, 24);
  }

  async function readCandidate(drive) {
    const markerPath = join(drive, markerFile);
    if (!existsSync(markerPath)) return undefined;
    const info = await stat(markerPath);
    if (!info.isFile()) return undefined;
    const raw = (await readFile(markerPath, 'utf8')).replace(/^\uFEFF/, '');
    let declared;
    try {
      declared = JSON.parse(raw);
    } catch {
      declared = { id: raw.trim() };
    }
    if (declared === null || typeof declared !== 'object') return undefined;
    if (declared.plugin !== undefined && declared.plugin !== name) return undefined;
    return {
      // The drive letter (or POSIX mount path) is display-only: the marker file
      // existing on any mounted volume is the whole trigger condition.
      storage: drive.replace(/\\$/, ''),
      label: typeof declared.volumeLabel === 'string' ? declared.volumeLabel : null,
      markerId: typeof declared.id === 'string' ? declared.id : null,
      digest: markerDigest(drive, raw, markerPath),
    };
  }

  async function detectOnce() {
    for (const drive of await mountRoots()) {
      try {
        if (!existsSync(drive)) continue;
        const candidate = await readCandidate(drive);
        if (candidate !== undefined) return candidate;
      } catch {
        // A vanishing drive between existsSync and readFile is a normal race.
      }
    }
    return undefined;
  }

  /** Last observed device state, used to keep the audit trail transition-only. */
  let lastAuditState = 'init';
  let lastStatusAuditAt = 0;
  const statusStats = { calls: 0, lastAt: 0 };

  async function scan(now = Date.now()) {
    if (now - lastScanAt < 250) return present;
    lastScanAt = now;
    let next;
    try {
      next = await detectOnce();
    } catch {
      next = undefined;
    }
    present = next ?? null;
    const state = next === undefined ? 'absent' : `present:${next.digest}`;
    if (state !== lastAuditState) {
      lastAuditState = state;
      await audit({ event: 'scan', state });
    }
    if (next === undefined) {
      pending = null;
      // The medium is gone: the next connection is a new mount and may prompt again.
      suppressedDigest = null;
      return present;
    }
    if (suppressedDigest !== null && suppressedDigest !== next.digest) {
      // A different medium arrived; the previous suppression no longer applies.
      suppressedDigest = null;
    }
    const sameMount = pending !== null && pending.digest === next.digest;
    if (!sameMount) {
      pending = {
        digest: next.digest,
        since: now,
        acknowledgedAt: suppressedDigest === next.digest ? now : null,
        details: next,
      };
    } else {
      // Refresh the details without touching the acknowledgement, and keep the
      // prompt buried for a medium whose deletion already ran.
      pending = {
        ...pending,
        details: next,
        acknowledgedAt: suppressedDigest === next.digest ? pending.acknowledgedAt ?? now : pending.acknowledgedAt,
      };
    }
    return present;
  }

  function pendingView(now = Date.now()) {
    if (pending === null) return null;
    const details = pending.details ?? {};
    return {
      digest: pending.digest,
      since: pending.since,
      acknowledged: pending.acknowledgedAt !== null || suppressedDigest === pending.digest,
      erased: suppressedDigest === pending.digest,
      now,
      drive: details.storage ?? 'storage',
      volumeLabel: details.label ?? null,
      markerFile,
      markerId: details.markerId ?? null,
    };
  }

  function liveSessionOf(sessionId) {
    return ctx.get('sessions')?.get(String(sessionId));
  }

  function contextSnapshot(sessionId) {
    const session = liveSessionOf(sessionId);
    if (session === undefined) return { available: false };
    const contextWindow = session.requestContext()?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    let tokens;
    try {
      const measurement = ctx.get('tokenMeter')?.measure(session);
      if (measurement !== undefined) tokens = measurement.surfaceTokens + (measurement.baseline?.tokens ?? 0);
    } catch {
      tokens = undefined;
    }
    if (tokens === undefined) {
      const messages = session.deriveMessages();
      const text = messages.reduce((total, message) => {
        const blocks = Array.isArray(message?.content) ? message.content : [];
        return total + blocks.reduce((sum, block) => sum + (typeof block?.text === 'string' ? block.text.length : 0), 0);
      }, 0);
      tokens = Math.ceil(text / 3.2) + messages.length * 8;
    }
    const used = Math.max(0, Math.round(tokens));
    const window = Math.max(1, Math.round(contextWindow));
    return {
      available: true,
      usedTokens: used,
      contextWindow: window,
      remainingTokens: Math.max(0, window - used),
      usedRatio: Math.min(1, used / window),
      remainingRatio: Math.max(0, 1 - used / window),
    };
  }

  function sessionMeta(sessionId) {
    const id = String(sessionId);
    const session = liveSessionOf(id);
    return {
      sessionId: id,
      title: null,
      cwd: typeof session?.header?.cwd === 'string' ? session.header.cwd : null,
      agentPreset: typeof session?.header?.agentPreset === 'string' ? session.header.agentPreset : null,
      live: session !== undefined,
      context: contextSnapshot(id),
    };
  }

  /** Find the on-disk artifact directory for one Session under the live session root. */
  async function findSessionArtifact(sessionId, cwd) {
    const id = String(sessionId);
    const candidates = [];
    if (typeof cwd === 'string' && cwd !== '') {
      try {
        candidates.push(join(sessionsRootPath, projectKey(cwd), id));
      } catch {
        // A malformed cwd only skips the direct layout.
      }
    }
    candidates.push(join(sessionsRootPath, '_no-cwd', id));
    for (const candidate of candidates) {
      try {
        if ((await stat(candidate)).isDirectory()) return candidate;
      } catch {
        // Try the next layout.
      }
    }
    try {
      const projects = await readdir(sessionsRootPath, { withFileTypes: true });
      for (const project of projects) {
        if (!project.isDirectory()) continue;
        const candidate = join(sessionsRootPath, project.name, id);
        try {
          if ((await stat(candidate)).isDirectory()) return candidate;
        } catch {
          // Keep scanning.
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  async function waitFor(fn, attempts, delayMs) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) await new Promise((done) => setTimeout(done, delayMs));
      }
    }
    throw lastError;
  }

  async function moveToTrash(directory, sessionId) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const root = trashRoot();
    await mkdir(root, { recursive: true });
    const destination = join(root, `${String(sessionId)}.${stamp}`);
    await waitFor(() => rename(directory, destination), 6, 400);
    return destination;
  }

  async function sweepTrash() {
    if (trashRetentionDays <= 0) return;
    const root = trashRoot();
    if (!existsSync(root)) return;
    const cutoff = Date.now() - trashRetentionDays * 24 * 60 * 60 * 1000;
    let entries;
    try {
      entries = await readdir(root);
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = join(root, entry);
      try {
        if ((await stat(target)).mtimeMs < cutoff) await rm(target, { recursive: true, force: true });
      } catch {
        // A concurrent sweep already removed it.
      }
    }
  }

  function resolveEraseTarget(requestedSessionId) {
    if (typeof requestedSessionId === 'string' && requestedSessionId !== '') {
      try {
        if (liveSessionOf(requestedSessionId) !== undefined) return requestedSessionId;
      } catch {
        // Fall through to the live-session heuristic.
      }
    }
    const live = ctx.get('agents')?.list?.() ?? [];
    return live.length === 0 ? undefined : String(live[live.length - 1].id);
  }

  async function eraseSession(request) {
    const sessionId = resolveEraseTarget(request?.sessionId);
    if (sessionId === undefined) {
      return { ok: false, code: 'no-session', message: '没有可删除的当前会话。' };
    }
    const session = liveSessionOf(sessionId);
    if (session === undefined) {
      return { ok: false, code: 'session-not-live', message: '当前会话尚未在 Host 中激活，无法删除。请先在当前会话里发送一条消息再试。' };
    }
    const cwd = typeof session.header?.cwd === 'string' ? session.header.cwd : undefined;
    await audit({
      event: 'erase-request',
      requested: request?.sessionId ?? null,
      resolved: sessionId,
      preview: request?.preview === true,
      cwd: cwd ?? null,
      context: contextSnapshot(sessionId),
    });
    if (request?.preview === true) {
      const artifact = await findSessionArtifact(sessionId, cwd);
      return {
        ok: true,
        preview: true,
        sessionId,
        cwd: cwd ?? null,
        artifact: artifact ?? null,
        context: contextSnapshot(sessionId),
      };
    }
    const agentPreset = typeof session.header?.agentPreset === 'string' ? session.header.agentPreset : undefined;
    const controller = ctx.get('sessionController');
    const registry = ctx.get('workspaceRegistry');
    const workspace = cwd === undefined ? undefined : registry?.list?.().find((item) => item.path === cwd);
    let successor;
    try {
      successor = await controller.create({
        ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
        ...(workspace === undefined && cwd !== undefined ? { cwd } : {}),
        ...(agentPreset === undefined ? {} : { agentPreset }),
      });
    } catch (error) {
      return {
        ok: false,
        code: 'successor-failed',
        message: `无法创建空白会话：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    try {
      await registry?.archiveSession?.(sessionId, { stopActivity: true });
    } catch (error) {
      return {
        ok: false,
        code: 'archive-failed',
        message: `无法归档原会话：${error instanceof Error ? error.message : String(error)}`,
        successorSessionId: successor?.sessionId ?? null,
      };
    }
    let artifact;
    try {
      artifact = await findSessionArtifact(sessionId, cwd);
      if (artifact !== undefined) await moveToTrash(artifact, sessionId);
      void sweepTrash();
    } catch (error) {
      await audit({
        event: 'erase-partial',
        sessionId,
        successorSessionId: successor?.sessionId ?? null,
        artifact: artifact ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: true,
        moved: false,
        warning: `会话已归档并新建空白会话，但记录文件仍被占用，暂未移入回收区：${error instanceof Error ? error.message : String(error)}`,
        sessionId,
        successorSessionId: successor?.sessionId ?? null,
        workspaceId: workspace?.id ?? null,
        cwd: cwd ?? null,
        trashRetentionDays,
      };
    }
    await audit({
      event: 'erase-done',
      sessionId,
      successorSessionId: successor?.sessionId ?? null,
      artifact: artifact ?? null,
      workspaceId: workspace?.id ?? null,
    });
    return {
      ok: true,
      moved: artifact !== undefined,
      sessionId,
      successorSessionId: successor?.sessionId ?? null,
      workspaceId: workspace?.id ?? null,
      cwd: cwd ?? null,
      trashRetentionDays,
    };
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://plugin.invalid');
    const method = req.method ?? 'GET';
    const action = url.pathname === `${ROUTE_PREFIX}/status`
      ? 'status'
      : url.pathname === `${ROUTE_PREFIX}/ack`
        ? 'ack'
        : url.pathname === `${ROUTE_PREFIX}/rearm`
          ? 'rearm'
          : url.pathname === `${ROUTE_PREFIX}/erase`
          ? 'erase'
          : url.pathname === `${ROUTE_PREFIX}/probe` && testMode
            ? 'probe'
            : url.pathname === `${ROUTE_PREFIX}/debug`
              ? 'debug'
              : url.pathname === `${ROUTE_PREFIX}/test-trigger` && testMode
                ? 'test-trigger'
                : undefined;
    if (action === undefined) return sendJson(res, 404, { error: 'unknown-memory-erase-endpoint', path: url.pathname });
    if (method === 'OPTIONS') {
      res.writeHead(204, { allow: 'GET, POST, OPTIONS' });
      return res.end();
    }
    try {
      if (action === 'status') {
        await scan();
        const sessionId = url.searchParams.get('sessionId') ?? undefined;
        statusStats.calls += 1;
        statusStats.lastAt = Date.now();
        if (statusStats.calls === 1 || statusStats.lastAt - lastStatusAuditAt > 15000) {
          lastStatusAuditAt = statusStats.lastAt;
          await audit({
            event: 'status-poll',
            calls: statusStats.calls,
            requested: sessionId ?? null,
            live: sessionId === undefined ? null : liveSessionOf(sessionId) !== undefined,
            device: pending?.digest ?? null,
            acknowledged: pending?.acknowledgedAt !== null && pending?.acknowledgedAt !== undefined,
          });
        }
        return sendJson(res, 200, {
          plugin: name,
          now: Date.now(),
          intervalMs: pollIntervalMs,
          device: pendingView(),
          session: sessionId === undefined ? null : sessionMeta(sessionId),
          sessionsRoot: sessionsRootPath,
        });
      }
      if (action === 'ack') {
        if (pending !== null) pending = { ...pending, acknowledgedAt: Date.now() };
        return sendJson(res, 200, { ok: true, device: pendingView() });
      }
      if (action === 'rearm') {
        await scan();
        if (pending === null) return sendJson(res, 200, { ok: false, device: null, reason: 'no-medium' });
        if (suppressedDigest === pending.digest) {
          // The deletion already ran for this connection; a manual re-arm must not
          // resurrect the prompt until the medium is reconnected.
          return sendJson(res, 200, { ok: false, device: pendingView(), reason: 'already-erased' });
        }
        pending = { ...pending, acknowledgedAt: null };
        return sendJson(res, 200, { ok: true, device: pendingView() });
      }
      if (action === 'debug') {
        return sendJson(res, 200, {
          ok: true,
          device: pendingView(),
          live: (ctx.get('agents')?.list?.() ?? []).map((agent) => String(agent.id)),
          stats: statusStats,
          sessionsRoot: sessionsRootPath,
        });
      }
      if (action === 'probe') {
        // Local-only verification hook: prove predecessor archive + distinct
        // successor creation against the real Host services without erasing a
        // conversation the user still cares about.
        const registry = ctx.get('workspaceRegistry');
        const controller = ctx.get('sessionController');
        const workspace = registry?.list?.()[0];
        const cwd = workspace?.path ?? url.searchParams.get('cwd') ?? undefined;
        const first = await controller.create({
          ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
          ...(workspace === undefined && cwd !== undefined ? { cwd } : {}),
        });
        let second;
        try {
          await registry?.archiveSession?.(first.sessionId, { stopActivity: true });
          second = await controller.create({
            ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
            ...(workspace === undefined && cwd !== undefined ? { cwd } : {}),
          });
        } catch (error) {
          return sendJson(res, 500, {
            ok: false,
            first: first.sessionId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return sendJson(res, 200, {
          ok: true,
          first: first.sessionId,
          second: second.sessionId,
          distinct: second.sessionId !== first.sessionId,
        });
      }
      if (action === 'test-trigger') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
        suppressedDigest = null;
        pending = {
          digest: `test-${randomUUID()}`,
          since: Date.now(),
          acknowledgedAt: null,
          details: { storage: 'test-trigger', label: 'TEST MEDIUM', markerId: 'test' },
        };
        return sendJson(res, 200, { ok: true, device: pendingView() });
      }
      if (action === 'erase') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
        const body = await readJsonBody(req);
        const result = await eraseSession(body ?? {});
        if (result.ok && result.preview !== true && pending !== null) {
          // One erase per connection: keep the prompt down even after the blank
          // successor Session becomes the displayed one.
          suppressedDigest = pending.digest;
          pending = { ...pending, acknowledgedAt: Date.now() };
        }
        return sendJson(res, result.ok ? 200 : 409, result);
      }
      return sendJson(res, 405, { error: 'method-not-allowed' });
    } catch (error) {
      return sendJson(res, 500, {
        error: 'memory-erase-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: handle,
      }),
    'memory-erase: plugin http route',
  );

  // Prime detection once so the first status call does not race the first scan.
  scan().catch(() => undefined);
  const timer = setInterval(() => {
    scan().catch(() => undefined);
  }, pollIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  ctx.effect(() => () => clearInterval(timer), 'memory-erase: removable-media poll');
}
