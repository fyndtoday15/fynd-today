const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

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

  if (!ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const BASE_ID = 'app6jfIbr50JLlJTi';
  const AIRTABLE_BASE = 'https://api.airtable.com/v0/' + BASE_ID + '/';
  const AIRTABLE_HEADERS = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json',
  };

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { email } = data;
  if (!email) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: false, error: 'Missing email' }),
    };
  }

  // Fetch all session state records for this email, return the best one
  try {
    const filterFormula = encodeURIComponent(`AND({Email}="${email}",{Track ID}="SESSION_STATE")`);
    const sessRes = await fetch(
      AIRTABLE_BASE + encodeURIComponent('Sessions') + '?filterByFormula=' + filterFormula + '&maxRecords=20',
      { headers: AIRTABLE_HEADERS }
    );
    const sessData = await sessRes.json();

    let bestState = null;
    let bestScore = -1;

    if (sessData.records && sessData.records.length > 0) {
      for (var j = 0; j < sessData.records.length; j++) {
        var rawState = sessData.records[j].fields['Session State'];
        if (!rawState) continue;
        var parsed = null;
        try { parsed = JSON.parse(rawState); } catch(e) { continue; }
        if (!parsed) continue;
        var completedCount = (parsed.completedSets || []).length;
        var curPos = parsed.cur || 0;
        var updatedAt = parsed.updatedAt || 0;
        var score = completedCount * 10000 + curPos * 100 + (updatedAt > 0 ? 1 : 0);
        if (score > bestScore || (score === bestScore && updatedAt > (bestState ? bestState.updatedAt || 0 : 0))) {
          bestScore = score;
          bestState = parsed;
        }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true, state: bestState }),
    };

  } catch(err) {
    console.error('Sync state error:', err);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true, state: null }),
    };
  }
};
