// Allowed origins
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
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const BASE_ID = 'app6jfIbr50JLlJTi';
  const OTP_TABLE = 'OTP';
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
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: false, error: 'Invalid email' }),
    };
  }

  // Generate 6-digit OTP
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

  // Store OTP in Airtable
  try {
    const atRes = await fetch(AIRTABLE_BASE + encodeURIComponent(OTP_TABLE), {
      method: 'POST',
      headers: AIRTABLE_HEADERS,
      body: JSON.stringify({
        records: [{
          fields: {
            'Email': email,
            'Code': code,
            'Expires': expires,
          }
        }]
      }),
    });
    if (!atRes.ok) {
      const atErr = await atRes.json();
      console.error('Airtable OTP write error:', atErr);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ success: false, error: 'Could not save code' }),
      };
    }
  } catch(err) {
    console.error('Airtable OTP error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: false, error: 'Server error' }),
    };
  }

  // Send OTP via Brevo transactional email
  try {
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'FYND TODAY', email: 'bradley@fyndtoday.com' },
        to: [{ email: email }],
        subject: 'Your FYND TODAY sign-in code',
        htmlContent: `
          <div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:32px;color:#000;">
            <p style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.6;margin-bottom:24px;">FYND TODAY</p>
            <p style="font-size:18px;margin-bottom:8px;">Your sign-in code:</p>
            <p style="font-size:42px;font-weight:700;letter-spacing:0.15em;margin:24px 0;">${code}</p>
            <p style="font-size:13px;opacity:0.55;line-height:1.6;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
          </div>
        `,
      }),
    });
    if (!brevoRes.ok) {
      const brevoErr = await brevoRes.json();
      console.error('Brevo OTP send error:', brevoErr);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ success: false, error: 'Could not send email' }),
      };
    }
  } catch(err) {
    console.error('Brevo send error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: false, error: 'Email send failed' }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': allowedOrigin },
    body: JSON.stringify({ success: true }),
  };
};
