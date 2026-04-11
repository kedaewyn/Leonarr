import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');

let winstonInstance = null;
let initFailed = false;

function resolveLogDir(raw) {
  if (!raw || typeof raw !== 'string') return path.join(PLUGIN_ROOT, 'logs');
  return path.isAbsolute(raw) ? raw : path.resolve(PLUGIN_ROOT, raw);
}

async function buildWinston(logDir, level) {
  const winstonMod = await import('winston');
  const winston = winstonMod.default || winstonMod;
  const rotateMod = await import('winston-daily-rotate-file');
  const DailyRotateFile = rotateMod.default || rotateMod;

  const { combine, timestamp, errors, splat, json } = winston.format;

  const fileFormat = combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    errors({ stack: true }),
    splat(),
    json(),
  );

  const combinedTransport = new DailyRotateFile({
    dirname: logDir,
    filename: 'leonarr-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    level,
  });

  const errorTransport = new DailyRotateFile({
    dirname: logDir,
    filename: 'leonarr-error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
  });

  const logger = winston.createLogger({
    level,
    format: fileFormat,
    defaultMeta: { service: 'leonarr' },
    transports: [combinedTransport, errorTransport],
  });

  // Surface transport errors (disk full, permissions) without crashing.
  for (const t of [combinedTransport, errorTransport]) {
    t.on('error', (err) => {
      // Don't recurse into winston — write straight to stderr.
      // eslint-disable-next-line no-console
      console.error('[Leonarr] winston transport error:', err?.message || err);
    });
  }

  return logger;
}

export async function initLogger(opts = {}) {
  if (winstonInstance || initFailed) return winstonInstance;

  const logDir = resolveLogDir(opts.logDir);
  const level = opts.logLevel || 'info';

  try {
    fs.mkdirSync(logDir, { recursive: true });
    winstonInstance = await buildWinston(logDir, level);
    opts.fallbackLog?.info(`[Leonarr] winston logger ready → ${logDir} (level=${level})`);
  } catch (err) {
    initFailed = true;
    opts.fallbackLog?.warn(
      `[Leonarr] winston init failed (${err?.message || err}) — file logs disabled, Oscarr logger still active`
    );
  }
  return winstonInstance;
}

export async function closeLogger() {
  if (!winstonInstance) return;
  try {
    winstonInstance.close();
  } catch { /* ignore */ }
  winstonInstance = null;
  initFailed = false;
}


export function teeLogger(ctxLog) {
  const forward = (method) => (...args) => {
    // Oscarr first — it must never be silenced by a winston hiccup.
    try { ctxLog?.[method]?.(...args); } catch { /* ignore */ }
    if (!winstonInstance) return;
    try {
      // Winston expects (message, ...meta). We pass the first arg as the
      // message and flatten Errors so the stack trace is captured.
      const [first, ...rest] = args;
      if (first instanceof Error) {
        winstonInstance[method](first.message, { stack: first.stack, meta: rest });
      } else {
        winstonInstance[method](first, ...rest);
      }
    } catch { /* ignore */ }
  };

  return {
    info:  forward('info'),
    warn:  forward('warn'),
    error: forward('error'),
    debug: forward('debug'),
    // Some callers expect .child() — return the same shape.
    child: () => teeLogger(ctxLog),
  };
}

export function wrapCtx(ctx) {
  return { ...ctx, log: teeLogger(ctx.log) };
}
