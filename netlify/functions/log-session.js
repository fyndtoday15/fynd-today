// Allowed origins
const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

// In-memory rate limit — per function instance
const rateLimitMap = {};
const RATE_LIMIT = 10;
const RATE_WINDOW = 60000;

function isRateLimited(ip) {
  const now = Date.now();
  if (!rateLimitMap[ip]) rateLimitMap[ip] = [];
  rateLimitMap[ip] = rateLimitMap[ip].filter(t => now - t < RATE_WINDOW);
  if (rateLimitMap[ip].length >= RATE_LIMIT) return true;
  rateLimitMap[ip].push(now);
  return false;
}

function sanitizeString(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.slice(0, maxLen).replace(/[<>]/g, '');
}

exports.handler = async function(event, context) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Block requests not from your domain
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  // Rate limiting
  const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  if (isRateLimited(ip)) {
    return { statusCode: 429, body: 'Too Many Requests' };
  }

  // Payload size check
  if (event.body && event.body.length > 10000) {
    return { statusCode: 413, body: 'Payload Too Large' };
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const BASE_ID = 'app6jfIbr50JLlJTi';
  const TABLE_NAME = 'Sessions';
  const BASE_URL = 'https://api.airtable.com/v0/' + BASE_ID + '/' + encodeURIComponent(TABLE_NAME);
  const HEADERS = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json',
  };

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Honeypot check — bots fill hidden fields, real users don't
  if (data.hp && data.hp.length > 0) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  // EMAIL + NAME — write a dedicated record so it never fails
  if (data.emailUpdate) {
    try {
      const response = await fetch(BASE_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          records: [{
            fields: {
              'Session ID': sanitizeString(data.sessionId, 64),
              'First Name': sanitizeString(data.firstName, 100),
              'Email': sanitizeString(data.email, 200),
              'Entry State': sanitizeString(data.entryState, 100),
              'Track ID': 'EMAIL',
              'Track Title': 'Email Record',
              'Playlist': '',
              'Duration': 0,
              'Position': '',
              'Week': '',
            }
          }]
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error('Email record error:', result);
        return {
          statusCode: 500,
          headers: { 'Access-Control-Allow-Origin': allowedOrigin },
          body: JSON.stringify(result),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ success: true }),
      };
    } catch(err) {
      console.error('Email update error:', err);
      return { statusCode: 500, body: err.toString() };
    }
  }

  // TRACK LOG — create one record per track assignment
  const { sessionId, email, firstName, entryState, assignments } = data;

  if (!assignments || assignments.length === 0) {
    return { statusCode: 400, body: 'No assignments' };
  }

  if (assignments.length > 5) {
    return { statusCode: 400, body: 'Too many assignments' };
  }

  const records = assignments.map(function(a) {
    return {
      fields: {
        'Session ID': sanitizeString(sessionId, 64),
        'First Name': sanitizeString(firstName, 100),
        'Entry State': sanitizeString(entryState, 100),
        'Track ID': sanitizeString(a.trackId, 20),
        'Track Title': sanitizeString(a.trackTitle, 200),
        'Playlist': sanitizeString(a.playlist, 50),
        'Duration': Math.min(Math.max(Number(a.duration) || 0, 0), 60),
        'Position': sanitizeString(a.postState, 50),
        'Email': sanitizeString(email, 200),
        'Week': sanitizeString(a.week, 10),
        'Reaction': sanitizeString(a.reaction, 20),
        'Visit Number': Math.min(Math.max(Number(a.visitNumber) || 1, 1), 9999),
        'Days Since Last Visit': (a.daysSinceLastVisit !== undefined && a.daysSinceLastVisit !== null && a.daysSinceLastVisit !== '') ? Math.min(Number(a.daysSinceLastVisit), 9999) : null,
        'Triggered': sanitizeString(a.triggered, 20),
      }
    };
  });

  try {
    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ records: records }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Airtable error:', result);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify(result),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true, created: result.records.length }),
    };

  } catch(err) {
    console.error('Fetch error:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
