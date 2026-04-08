// Allowed origins
const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

const DIRECTION = {
  'Stay': 'When you want to stay with the moment.',
  'Move': "When you're ready to shift from the moment.",
  'Open': 'When the moment reveals something new.',
  'Something Else': 'When none of these landed — keep listening.',
};

const SET_NAMES = {
  'MVP 1':   'Set 1',
  'MVP 1.2': 'Set 2',
  'MVP 1.3': 'Set 3',
  'MVP 1.4': 'Set 4',
  'MVP 1.5': 'Set 5',
};

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

  const BREVO_API_KEY = process.env.BREVO_API_KEY;

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { email, firstName, playlist, log } = data;

  if (!email || !firstName || !playlist || !log || !log.length) {
    return { statusCode: 400, body: 'Missing required fields' };
  }

  // Build recap text — only answered tracks (skip Skipped)
  const recapLines = log
    .filter(function(a) { return a.postState && a.postState !== 'Skipped'; })
    .map(function(a) {
      const direction = DIRECTION[a.postState] || '';
      return '<p style="margin:0 0 20px 0;">'
        + '<span style="font-size:15px;color:#000000;font-weight:400;">' + (a.trackTitle || '') + '</span><br>'
        + '<span style="font-size:12px;color:#000000;opacity:0.4;">' + direction + '</span>'
        + '</p>';
    })
    .join('');

  const setName = SET_NAMES[playlist] || playlist;

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateId: 2,
        to: [{ email: email, name: firstName }],
        params: {
          firstName: firstName,
          setName: setName,
          recap: recapLines,
        },
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Brevo recap error:', result);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify(result),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true }),
    };
  } catch(err) {
    console.error('Recap email error:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
