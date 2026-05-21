// Allowed origins
const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

// In-memory rate limit — per function instance
const rateLimitMap = {};
const RATE_LIMIT = 60;
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

// Fetch with timeout — prevents hanging on slow Airtable responses
function fetchWithTimeout(url, options, ms) {
  ms = ms || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}

exports.handler = async function(event, context) {
  // Critical: allows Netlify to return response immediately without waiting
  // for event loop to drain — essential for sendBeacon requests on tab close
  context.callbackWaitsForEmptyEventLoop = false;

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
    // Require consent for email records
    if (!data.consent) {
      return { statusCode: 400, body: 'Consent required' };
    }
    try {
      const response = await fetchWithTimeout(BASE_URL, {
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
              'Date': '',
              'Consent': data.consent ? 'Yes' : 'No',
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

  // ENTRY STATE — write a dedicated record on every entry state selection
  if (data.entryUpdate) {
    try {
      const response = await fetchWithTimeout(BASE_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          records: [{
            fields: {
              'Session ID': sanitizeString(data.sessionId, 64),
              'First Name': sanitizeString(data.firstName, 100),
              'Email': sanitizeString(data.email, 200),
              'Entry State': sanitizeString(data.entryState, 100),
              'Track ID': 'ENTRY',
              'Track Title': 'Entry State Record',
              'Playlist': sanitizeString(data.playlist, 50),
              'Duration': 0,
              'Position': '',
              'Date': sanitizeString(data.date, 10),
              'Visit Number': Math.min(Math.max(Number(data.visitNumber) || 1, 1), 9999),
              'Days Since Last Visit': (data.daysSinceLastVisit !== undefined && data.daysSinceLastVisit !== null && data.daysSinceLastVisit !== '') ? Math.min(Number(data.daysSinceLastVisit), 9999) : null,
            }
          }]
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error('Entry state record error:', result);
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
      console.error('Entry update error:', err);
      return { statusCode: 500, body: err.toString() };
    }
  }

  // TRACK START — create in-progress record immediately, return Airtable record ID
  if (data.trackStart) {
    const fields = {
      'Session ID': sanitizeString(data.sessionId, 64),
      'First Name': sanitizeString(data.firstName, 100),
      'Email': sanitizeString(data.email, 200),
      'Entry State': sanitizeString(data.entryState, 100),
      'Track ID': sanitizeString(data.trackId, 20),
      'Track Title': sanitizeString(data.trackTitle, 200),
      'Playlist': sanitizeString(data.playlist, 50),
      'Duration': 0,
      'Position': 'In Progress',
      'Date': sanitizeString(data.date, 10),
      'Reaction': '',
      'Visit Number': Math.min(Math.max(Number(data.visitNumber) || 1, 1), 9999),
      'Days Since Last Visit': (data.daysSinceLastVisit !== undefined && data.daysSinceLastVisit !== null && data.daysSinceLastVisit !== '') ? Math.min(Number(data.daysSinceLastVisit), 9999) : null,
      'Triggered': '',
      'Replay': '',
    };
    try {
      const response = await fetchWithTimeout(BASE_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ records: [{ fields }] }),
      });
      const result = await response.json();
      if (!response.ok) {
        console.error('Track start error:', result);
        return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': allowedOrigin }, body: JSON.stringify(result) };
      }
      const recordId = result.records[0].id;
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': allowedOrigin }, body: JSON.stringify({ success: true, recordId: recordId }) };
    } catch(err) {
      console.error('Track start error:', err);
      return { statusCode: 500, body: err.toString() };
    }
  }

  // TRACK PATCH — update specific record by Airtable record ID
  // Used for tab-close beacon and stop-for-now — fastest path, single request
  if (data.trackPatch) {
    const pFields = {
      'Duration': Math.max(Number(data.duration) || 0, 0),
      'Position': sanitizeString(data.postState || 'In Progress', 50),
    };
    if (data.reaction !== undefined) pFields['Reaction'] = sanitizeString(data.reaction, 20);
    if (data.triggered) pFields['Triggered'] = sanitizeString(data.triggered, 20);
    if (data.replay) pFields['Replay'] = sanitizeString(data.replay, 5);
    if (data.email) pFields['Email'] = sanitizeString(data.email, 200);
    if (data.firstName) pFields['First Name'] = sanitizeString(data.firstName, 100);
    try {
      const response = await fetchWithTimeout(BASE_URL + '/' + sanitizeString(data.recordId, 30), {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify({ fields: pFields }),
      }, 6000); // 6s timeout — single request, must complete before function recycles
      const result = await response.json();
      if (!response.ok) {
        console.error('Track patch error:', result);
        return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': allowedOrigin }, body: JSON.stringify(result) };
      }
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': allowedOrigin }, body: JSON.stringify({ success: true }) };
    } catch(err) {
      console.error('Track patch error:', err);
      return { statusCode: 500, body: err.toString() };
    }
  }

  // HEARTBEAT — upsert in-progress record by sessionId+trackId
  // Only matches In Progress records — never touches completed ones
  if (data.heartbeatUpdate) {
    const hSessionId = sanitizeString(data.sessionId, 64);
    const hTrackId = sanitizeString(data.trackId, 20);
    const hFields = {
      'Session ID': hSessionId,
      'First Name': sanitizeString(data.firstName, 100),
      'Email': sanitizeString(data.email, 200),
      'Entry State': sanitizeString(data.entryState, 100),
      'Track ID': hTrackId,
      'Track Title': sanitizeString(data.trackTitle, 200),
      'Playlist': sanitizeString(data.playlist, 50),
      'Duration': Math.max(Number(data.duration) || 0, 0),
      'Position': sanitizeString(data.postState || 'In Progress', 50),
      'Date': sanitizeString(data.date, 10),
      'Reaction': sanitizeString(data.reaction, 20),
      'Visit Number': Math.min(Math.max(Number(data.visitNumber) || 1, 1), 9999),
      'Days Since Last Visit': (data.daysSinceLastVisit !== undefined && data.daysSinceLastVisit !== null && data.daysSinceLastVisit !== '') ? Math.min(Number(data.daysSinceLastVisit), 9999) : null,
      'Triggered': sanitizeString(data.triggered, 20),
      'Replay': sanitizeString(data.replay, 5),
    };
    try {
      // Only match In Progress records — never patch completed ones
      const filterFormula = encodeURIComponent(`AND({Session ID}="${hSessionId}",{Track ID}="${hTrackId}",{Position}="In Progress")`);
      const findRes = await fetchWithTimeout(BASE_URL + '?filterByFormula=' + filterFormula + '&maxRecords=1', { headers: HEADERS }, 6000);
      const findData = await findRes.json();
      let response;
      if (findData.records && findData.records.length > 0) {
        response = await fetchWithTimeout(BASE_URL + '/' + findData.records[0].id, {
          method: 'PATCH',
          headers: HEADERS,
          body: JSON.stringify({ fields: hFields }),
        }, 6000);
      } else {
        response = await fetchWithTimeout(BASE_URL, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({ records: [{ fields: hFields }] }),
        }, 6000);
      }
      const result = await response.json();
      if (!response.ok) {
        console.error('Heartbeat error:', result);
        return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': allowedOrigin }, body: JSON.stringify(result) };
      }
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': allowedOrigin }, body: JSON.stringify({ success: true }) };
    } catch(err) {
      console.error('Heartbeat error:', err);
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
        'Duration': Math.max(Number(a.duration) || 0, 0),
        'Position': sanitizeString(a.postState, 50),
        'Email': sanitizeString(email, 200),
        'Date': sanitizeString(a.date, 10),
        'Reaction': sanitizeString(a.reaction, 20),
        'Visit Number': Math.min(Math.max(Number(a.visitNumber) || 1, 1), 9999),
        'Days Since Last Visit': (a.daysSinceLastVisit !== undefined && a.daysSinceLastVisit !== null && a.daysSinceLastVisit !== '') ? Math.min(Number(a.daysSinceLastVisit), 9999) : null,
        'Triggered': sanitizeString(a.triggered, 20),
        'Replay': sanitizeString(a.replay, 5),
      }
    };
  });

  try {
    const response = await fetchWithTimeout(BASE_URL, {
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
