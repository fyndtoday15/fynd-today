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
    const otpRes = await fetch(
      AIRTABLE_BASE + encodeURIComponent('OTP') + '?filterByFormula=' + filterFormula + '&maxRecords=10',
      { headers: AIRTABLE_HEADERS }
    );
    const otpData = await otpRes.json();
    console.log('OTP records found:', otpData.records ? otpData.records.length : 0);

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
    }).catch(function(e) { console.error('OTP delete error:', e); });
  } catch(e) {}

  // Step 3: Get ALL session state records for this email, pick the best one
  // "Best" = most completed sets, then highest cur, then most recent
  console.log('Looking up all session states for:', email);
  try {
    const filterFormula2 = encodeURIComponent(`AND({Email}="${email}",{Track ID}="SESSION_STATE")`);
    const sessRes = await fetch(
      AIRTABLE_BASE + encodeURIComponent('Sessions') + '?filterByFormula=' + filterFormula2 + '&maxRecords=20',
      { headers: AIRTABLE_HEADERS }
    );
    const sessData = await sessRes.json();
    console.log('Session state records found:', sessData.records ? sessData.records.length : 0);

    let bestState = null;
    let bestScore = -1;

    if (sessData.records && sessData.records.length > 0) {
      for (var j = 0; j < sessData.records.length; j++) {
        var rawState = sessData.records[j].fields['Session State'];
        if (!rawState) continue;
        var parsed = null;
        try { parsed = JSON.parse(rawState); } catch(e) { continue; }
        if (!parsed) continue;

        // Score: completed sets count * 100 + cur position
        var completedCount = (parsed.completedSets || []).length;
        var curPos = parsed.cur || 0;
        var updatedAt = parsed.updatedAt || 0;
        // Primary: most completed sets. Secondary: highest cur. Tertiary: most recent
        var score = completedCount * 10000 + curPos * 100 + (updatedAt > 0 ? 1 : 0);

        console.log('Record score:', score, 'completed:', completedCount, 'cur:', curPos, 'sessionId:', parsed.sessionId);

        if (score > bestScore || (score === bestScore && updatedAt > (bestState ? bestState.updatedAt || 0 : 0))) {
          bestScore = score;
          bestState = parsed;
        }
      }
    }

    console.log('Best state sessionId:', bestState ? bestState.sessionId : 'none');
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ success: true, state: bestState }),
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
