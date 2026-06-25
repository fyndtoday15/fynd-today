const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

const BASE_ID = 'app6jfIbr50JLlJTi';
const TABLE = 'Sessions';
const BASE_URL = 'https://api.airtable.com/v0/' + BASE_ID + '/' + encodeURIComponent(TABLE);

exports.handler = async function(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const cors = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!ALLOWED_ORIGINS.includes(origin)) return { statusCode: 403, body: 'Forbidden' };

  const KEY = process.env.AIRTABLE_API_KEY;
  if (!KEY) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Missing API key' }) };

  const headers = {
    'Authorization': 'Bearer ' + KEY,
    'Content-Type': 'application/json',
  };

  let data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const action = data.action;

  // ── CREATE — fires when a track starts playing ──────────────────────────────
  if (action === 'create') {
    try {
      const fields = {
        'Visitor ID':             data.visitorId || '',
        'Session ID':             data.sessionId || '',
        'Visit Number':           data.visitNumber || 1,
        'Days Since Last Visit':  data.daysSinceLastVisit || 0,
        'Timestamp':              data.timestamp || new Date().toISOString(),
        'Timezone':               data.timezone || '',
        'Entry Mode':             data.entryMode || '',
        'Track Title':            data.trackTitle || '',
        'Track Artist':           data.trackArtist || '',
        'YouTube Link':           data.youtubeLink || '',
        'Browser':                data.browser || '',
        'Device':                 data.device || '',
        'Status':                 'In Progress',
        'Replay Count':           0,
      };

      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ records: [{ fields }] }),
      });
      const body = await res.json();
      if (!res.ok) {
        console.error('create error:', body);
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: body }) };
      }
      // Return the Airtable record ID so the client can patch this row later
      const recordId = body.records[0].id;
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, recordId }) };
    } catch(err) {
      console.error('create catch:', err);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.toString() }) };
    }
  }

  // ── UPDATE — fires progressively as user taps words, colors, completes ──────
  if (action === 'update') {
    if (!data.recordId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing recordId' }) };
    try {
      const fields = {};
      if (data.wordsTapped !== undefined)      fields['Words Tapped']            = data.wordsTapped;
      if (data.colorsTapped !== undefined)     fields['Colors Tapped']           = data.colorsTapped;
      if (data.dominantPosition !== undefined) fields['Dominant Position']       = data.dominantPosition;
      if (data.formGenerated !== undefined)    fields['Form Generated']          = data.formGenerated;
      if (data.timeListened !== undefined)     fields['Time Listened (seconds)'] = data.timeListened;
      if (data.status !== undefined)           fields['Status']                  = data.status;
      if (data.replayCount !== undefined)      fields['Replay Count']            = data.replayCount;

      const res = await fetch(BASE_URL, {
        method: 'PATCH',
        headers: headers,
        body: JSON.stringify({ records: [{ id: data.recordId, fields }] }),
      });
      const body = await res.json();
      if (!res.ok) {
        console.error('update error:', body);
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: body }) };
      }
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
    } catch(err) {
      console.error('update catch:', err);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.toString() }) };
    }
  }

  // ── EMAIL PATCH — fires when user submits name/email in portal ──────────────
  if (action === 'emailPatch') {
    if (!data.visitorId || !data.email) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing visitorId or email' }) };
    }
    try {
      // Check if this email already exists under a different visitor ID
      const checkUrl = BASE_URL
        + '?filterByFormula=' + encodeURIComponent('AND({Email}="' + data.email + '",{Visitor ID}!="' + data.visitorId + '")')
        + '&maxRecords=1&fields%5B%5D=Visitor%20ID';
      const checkRes = await fetch(checkUrl, { headers });
      const checkBody = await checkRes.json();
      const linkedVisitorId = (checkBody.records && checkBody.records.length > 0)
        ? checkBody.records[0].fields['Visitor ID']
        : '';

      // Find all records for this visitor ID
      const searchUrl = BASE_URL
        + '?filterByFormula=' + encodeURIComponent('{Visitor ID}="' + data.visitorId + '"');
      const searchRes = await fetch(searchUrl, { headers });
      const searchBody = await searchRes.json();

      if (!searchBody.records || searchBody.records.length === 0) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ message: 'No records found' }) };
      }

      const patches = searchBody.records.map(function(r) {
        const fields = {
          'Name':  data.name || '',
          'Email': data.email || '',
        };
        if (data.consentTimestamp) {
          fields['Email Consent']     = 'Yes';
          fields['Consent Timestamp'] = data.consentTimestamp;
        }
        if (linkedVisitorId) {
          fields['Linked Visitor ID'] = linkedVisitorId;
        }
        return { id: r.id, fields };
      });

      // Airtable max 10 records per PATCH — batch if needed
      const BATCH = 10;
      for (let i = 0; i < patches.length; i += BATCH) {
        const batch = patches.slice(i, i + BATCH);
        await fetch(BASE_URL, {
          method: 'PATCH',
          headers: headers,
          body: JSON.stringify({ records: batch }),
        });
      }

      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ success: true, updated: patches.length, linkedVisitorId }),
      };
    } catch(err) {
      console.error('emailPatch catch:', err);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.toString() }) };
    }
  }

  return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Unknown action' }) };
};
