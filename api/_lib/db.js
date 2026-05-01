const { neon } = require('@neondatabase/serverless');

let _sql;

class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      'DATABASE_URL is not configured. Set DATABASE_URL for DB-backed API routes, ' +
      'or use the static JSON frontend without indicator APIs.'
    );
    this.name = 'MissingDatabaseUrlError';
    this.code = 'DATABASE_URL_MISSING';
    this.statusCode = 503;
  }
}

function getDb() {
  if (!_sql) {
    const databaseUrl = (process.env.DATABASE_URL || '').replace(/\\n/g, '').trim();
    if (!databaseUrl) throw new MissingDatabaseUrlError();
    _sql = neon(databaseUrl);
  }
  return _sql;
}

function isMissingDatabaseUrlError(err) {
  return err && (err.code === 'DATABASE_URL_MISSING' || err instanceof MissingDatabaseUrlError);
}

function sendDatabaseConfigError(res) {
  return res.status(503).json({
    error: 'Database not configured',
    detail: 'DATABASE_URL is required for DB-backed API routes.',
  });
}

function withDatabaseConfigError(handler) {
  return async function wrappedHandler(req, res) {
    try {
      return await handler(req, res);
    } catch (err) {
      if (isMissingDatabaseUrlError(err)) return sendDatabaseConfigError(res);
      throw err;
    }
  };
}

module.exports = {
  getDb,
  MissingDatabaseUrlError,
  isMissingDatabaseUrlError,
  sendDatabaseConfigError,
  withDatabaseConfigError,
};
