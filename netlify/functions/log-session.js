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

  // EMAIL + NAME — write a dedicated record so it never fails
  if (data.emailUpdate) {
    try {
      const response = await fetch(BASE_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          records: [{
            fields: {
              'Session ID': data.sessionId || '',
              'First Name': data.firstName || '',
              'Email': data.email || '',
              'Entry State': data.entryState || '',
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
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(result),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
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

  const records = assignments.map(function(a) {
    return {
      fields: {
        'Session ID': sessionId || '',
        'First Name': firstName || '',
        'Entry State': entryState || '',
        'Track ID': a.trackId || '',
        'Track Title': a.trackTitle || '',
        'Playlist': a.playlist || '',
        'Duration': a.duration || 0,
        'Position': a.postState || '',
        'Email': email || '',
        'Week': a.week || 'W01',
        'Reaction': a.reaction || '',
        'Visit Number': a.visitNumber || 1,
        'Days Since Last Visit': (a.daysSinceLastVisit !== undefined && a.daysSinceLastVisit !== null && a.daysSinceLastVisit !== '') ? Number(a.daysSinceLastVisit) : null,
        'Triggered': a.triggered || '',
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
