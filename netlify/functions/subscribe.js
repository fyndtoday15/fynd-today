const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

const BREVO_LIST_ID = 3;

exports.handler = async function(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    console.error('subscribe: BREVO_API_KEY not set');
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const email = (data.email || '').trim().toLowerCase();
  const firstName = (data.firstName || '').trim();

  if (!email || !firstName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Email and name are required' }),
    };
  }

  try {
    // Create or update contact in Brevo with list assignment
    const res = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        attributes: { FIRSTNAME: firstName },
        listIds: [BREVO_LIST_ID],
        updateEnabled: true, // update if contact already exists
      }),
    });

    const body = await res.json();

    // 201 = created, 204 = updated (no body), both are success
    if (res.status === 201 || res.status === 204) {
      console.log('subscribe: contact added/updated:', email);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true }),
      };
    }

    // Brevo returns 400 with code 'duplicate_parameter' if already on list — treat as success
    if (res.status === 400 && body.code === 'duplicate_parameter') {
      console.log('subscribe: contact already on list:', email);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true }),
      };
    }

    console.error('subscribe: Brevo error', res.status, body);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to add contact', detail: body.message }),
    };

  } catch(err) {
    console.error('subscribe: fetch error', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.toString() }),
    };
  }
};
