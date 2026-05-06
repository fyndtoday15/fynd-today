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

  if (event.body && event.body.length > 20000) {
    return { statusCode: 413, body: 'Payload Too Large' };
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const BASE_ID = 'app6jfIbr50JLlJTi';
  const TABLE_NAME = 'Sessions';
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

  const { sessionId, email, state } = data;
  if (!sessionId || !state) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: false, error: 'Missing sessionId or state' }),
    };
  }

  const stateJson = JSON.stringify(state);
  const now = new Date().toISOString();

  // Build fields to write — always include sessionId, include email if provided
  const fields = {
    'Session State': stateJson,
    'State Updated': now,
    'Track ID': 'SESSION_STATE',
    'Track Title': 'Session State Record',
    'Session ID': sessionId,
    'Playlist': state.playlist || '',
    'First Name': state.firstName || '',
    'Duration': 0,
  };
  if (email) {
    fields['Email'] = email;
  }

  try {
    // Look for existing state record by sessionId
    const filterFormula = encodeURIComponent(`AND({Session ID}="${sessionId}",{Track ID}="SESSION_STATE")`);
    const findRes = await fetch(
      AIRTABLE_BASE + encodeURIComponent(TABLE_NAME) + '?filterByFormula=' + filterFormula + '&maxRecords=1',
      { headers: AIRTABLE_HEADERS }
    );
    const findData = await findRes.json();

    if (findData.records && findData.records.length > 0) {
      // Update existing record
      const recordId = findData.records[0].id;
      await fetch(AIRTABLE_BASE + encodeURIComponent(TABLE_NAME) + '/' + recordId, {
        method: 'PATCH',
        headers: AIRTABLE_HEADERS,
        body: JSON.stringify({ fields }),
      });
    } else {
      // Create new record
      await fetch(AIRTABLE_BASE + encodeURIComponent(TABLE_NAME), {
        method: 'POST',
        headers: AIRTABLE_HEADERS,
        body: JSON.stringify({ records: [{ fields }] }),
      });
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true }),
    };

  } catch(err) {
    console.error('Save state error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: false, error: 'Server error' }),
    };
  }
};
