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

  const { email, code } = data;
  if (!email || !code) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: false, error: 'Missing fields' }),
    };
  }

  // Query OTP records by email only — validate code in JS to avoid Airtable type-matching issues
  try {
    const filterFormula = encodeURIComponent(`{Email}="${email}"`);
    const otpRes = await fetch(
      AIRTABLE_BASE + encodeURIComponent('OTP') + '?filterByFormula=' + filterFormula + '&sort%5B0%5D%5Bfield%5D=Expires&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=5',
      { headers: AIRTABLE_HEADERS }
    );
    const otpData = await otpRes.json();

    if (!otpData.records || otpData.records.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ success: false, error: 'Code not found' }),
      };
    }

    // Find a record where code matches and is not expired
    const now = Date.now();
    let matchedRecord = null;
    for (var i = 0; i < otpData.records.length; i++) {
      var rec = otpData.records[i];
      var storedCode = String(rec.fields['Code'] || '').trim();
      var expires = Number(rec.fields['Expires'] || 0);
      if (storedCode === String(code).trim() && now <= expires) {
        matchedRecord = rec;
        break;
      }
    }

    if (!matchedRecord) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ success: false, error: 'Code did not match or expired' }),
      };
    }

    // Delete used OTP record (fire-and-forget)
    fetch(AIRTABLE_BASE + encodeURIComponent('OTP') + '/' + matchedRecord.id, {
      method: 'DELETE',
      headers: AIRTABLE_HEADERS,
    }).catch(function(e) { console.error('OTP delete error:', e); });

  } catch(err) {
    console.error('OTP lookup error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: false, error: 'Server error' }),
    };
  }

  // OTP valid — look up session state from Sessions table by email
  try {
    const filterFormula2 = encodeURIComponent(`AND({Email}="${email}",{Track ID}="SESSION_STATE")`);
    const sessRes = await fetch(
      AIRTABLE_BASE + encodeURIComponent('Sessions') + '?filterByFormula=' + filterFormula2 + '&sort%5B0%5D%5Bfield%5D=State+Updated&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1',
      { headers: AIRTABLE_HEADERS }
    );
    const sessData = await sessRes.json();

    let state = null;
    if (sessData.records && sessData.records.length > 0) {
      const sessRecord = sessData.records[0];
      const rawState = sessRecord.fields['Session State'];
      if (rawState) {
        try { state = JSON.parse(rawState); } catch(e) { console.error('State parse error:', e); }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true, state: state }),
    };

  } catch(err) {
    console.error('Session state lookup error:', err);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true, state: null }),
    };
  }
};
