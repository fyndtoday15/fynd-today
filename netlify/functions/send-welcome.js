// Allowed origins
const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

exports.handler = async function(event, context) {
  const origin = event.headers.origin || event.headers.Origin || '';

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
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

  const BREVO_API_KEY = process.env.BREVO_API_KEY;

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { email, firstName } = data;

  if (!email || !firstName) {
    return { statusCode: 400, body: 'Missing email or firstName' };
  }

  const corsHeader = { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] };

  try {
    // Check if contact already exists in Brevo
    const checkResponse = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: { 'api-key': BREVO_API_KEY },
    });

    const contactExists = checkResponse.ok; // 200 = exists, 404 = new

    // Always upsert the contact (update name if exists, create if not)
    await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        attributes: { FIRSTNAME: firstName },
        updateEnabled: true,
      }),
    });

    // Only send welcome email if this is a new contact
    if (!contactExists) {
      const emailResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templateId: 1,
          to: [{ email: email, name: firstName }],
          params: { firstName: firstName },
        }),
      });

      const result = await emailResponse.json();

      if (!emailResponse.ok) {
        console.error('Brevo welcome error:', result);
        return {
          statusCode: 500,
          headers: corsHeader,
          body: JSON.stringify(result),
        };
      }
    }

    return {
      statusCode: 200,
      headers: corsHeader,
      body: JSON.stringify({ success: true, existing: contactExists }),
    };

  } catch(err) {
    console.error('Welcome email error:', err);
    return { statusCode: 500, headers: corsHeader, body: err.toString() };
  }
};
