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

  // Step 1: Validate OTP
  let matchedRecord = null;
  try {
    const filterFormula = encodeURIComponent(`{Email}="${email}"`);
    const otpUrl = AIRTABLE_BASE + encodeURIComponent('OTP') + '?filterByFormula=' + filterFormula + '&maxRecords=10';
    console.log('OTP query:', otpUrl);

    const otpRes = await fetch(otpUrl, { headers: AIRTABLE_HEADERS });
    const otpData = await otpRes.json();
    console.log('OTP response:', JSON.stringify(otpData));

    if (!otpData.records || otpData.records.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ success: false, error: 'Code not found' }),
      };
    }

    const now = Date.now();
    const submittedCode = String(code).trim();

    for (var i = 0; i < otpData.records.length; i++) {
      var rec = otpData.records[i];
      var storedCode = String(rec.fields['Code'] || '').trim();
      var expires = Number(rec.fields['Expires'] || 0);
      console.log('Comparing: stored=' + storedCode + ' submitted=' + submittedCode + ' now=' + now + ' expires=' + expires);
      if (storedCode === submittedCode && now <= expires) {
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

    console.log('OTP matched, record:', matchedRecord.id);
  } catch(err) {
    console.error('OTP lookup error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: false, error: 'Server error during OTP lookup' }),
    };
  }

  // Step 2: Delete used OTP
  try {
    fetch(AIRTABLE_BASE + encodeURIComponent('OTP') + '/' + matchedRecord.id, {
      method: 'DELETE',
      headers: AIRTABLE_HEADERS,
    }).then(function(r) {
      console.log('OTP delete status:', r.status);
    }).catch(function(e) {
      console.error('OTP delete error:', e);
    });
  } catch(e) {
    console.error('OTP delete setup error:', e);
  }

  // Step 3: Look up session state by email on SESSION_STATE record
  console.log('Looking up session state for email:', email);
  try {
    const filterFormula2 = encodeURIComponent(`AND({Email}="${email}",{Track ID}="SESSION_STATE")`);
    const sessRes = await fetch(
      AIRTABLE_BASE + encodeURIComponent('Sessions') + '?filterByFormula=' + filterFormula2 + '&sort%5B0%5D%5Bfield%5D=State+Updated&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1',
      { headers: AIRTABLE_HEADERS }
    );
    const sessData = await sessRes.json();
    console.log('Session state lookup:', JSON.stringify(sessData));

    let state = null;
    if (sessData.records && sessData.records.length > 0) {
      const rawState = sessData.records[0].fields['Session State'];
      if (rawState) {
        try { state = JSON.parse(rawState); } catch(e) { console.error('State parse error:', e); }
      }
    }

    console.log('Returning success, state:', state ? 'found' : 'null');
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true, state: state }),
    };

  } catch(err) {
    console.error('Session lookup error:', err);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true, state: null }),
    };
  }
};
