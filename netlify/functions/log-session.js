exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }; 
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const BASE_ID = 'app6jfIbr50JLlJTi';
  const TABLE_NAME = 'Sessions';

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { sessionId, email, entryState, assignments } = data;

  // Create one Airtable record per track assignment
  const records = assignments.map(function(a) {
    return {
      fields: {
        'Session ID': sessionId,
        'Entry State': entryState,
        'Track ID': a.trackId,
        'Duration': a.duration,
        'Post Assignment': a.postState,
        'Match': a.match,
        'Email': email || '',
        'Week': a.week || 'W01',
      }
    };
  });

  // Airtable accepts max 10 records per request — our sessions are 5 so fine
  try {
    const response = await fetch(
      'https://api.airtable.com/v0/' + BASE_ID + '/' + encodeURIComponent(TABLE_NAME),
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: records }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('Airtable error:', result);
      return { statusCode: 500, body: JSON.stringify(result) };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, created: result.records.length }),
    };

  } catch(err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
