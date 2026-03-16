exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
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

  // EMAIL + NAME UPDATE — find existing records by session ID and patch
  if (data.emailUpdate) {
    try {
      const searchUrl = BASE_URL + '?filterByFormula=' + encodeURIComponent('{Session ID}="' + data.sessionId + '"');
      const searchRes = await fetch(searchUrl, { headers: HEADERS });
      const searchData = await searchRes.json();

      if (!searchData.records || searchData.records.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ message: 'No records found' }) };
      }

      const patches = searchData.records.map(function(r) {
        return {
          id: r.id,
          fields: {
            'Email': data.email || '',
            'First Name': data.firstName || '',
          }
        };
      });

      await fetch(BASE_URL, {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify({ records: patches }),
      });

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, updated: patches.length }),
      };
    } catch(err) {
      console.error('Email update error:', err);
      return { statusCode: 500, body: err.toString() };
    }
  }

  // TRACK LOG — create new record for this track assignment
  const { sessionId, email, entryState, assignments } = data;

  if (!assignments || assignments.length === 0) {
    return { statusCode: 400, body: 'No assignments' };
  }

  const records = assignments.map(function(a) {
    return {
      fields: {
        'Session ID': sessionId || '',
        'First Name': '',
        'Entry State': entryState || '',
        'Track ID': a.trackId || '',
        'Track Title': a.trackTitle || '',
        'Playlist': a.playlist || '',
        'Duration': a.duration || 0,
        'Position': a.postState || '',
        'Email': '',
        'Week': a.week || 'W01',
        'Returning Visitor': a.returningVisitor || 'No',
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
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(result),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, created: result.records.length }),
    };

  } catch(err) {
    console.error('Fetch error:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
