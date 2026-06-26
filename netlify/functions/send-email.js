const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

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

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    console.error('send-email: BREVO_API_KEY not set');
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { templateId, email, firstName } = data;

  if (!templateId || !email) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing templateId or email' }) };
  }

  try {
    const payload = {
      templateId: templateId,
      to: [{ email: email, name: firstName || '' }],
    };

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let body = null;
    try { body = await res.json(); } catch(e) {}

    if (!res.ok) {
      console.error('send-email: Brevo error', res.status, body);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Failed to send email', detail: body && body.message }) };
    }

    console.log('send-email: sent template', templateId, 'to', email);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };

  } catch(err) {
    console.error('send-email: fetch error', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.toString() }) };
  }
};
