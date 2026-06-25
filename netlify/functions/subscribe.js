const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

const BREVO_LIST_ID = 3;
const AIRTABLE_BASE_ID = 'app6jfIbr50JLlJTi';
const AIRTABLE_TABLE = 'Sessions';
const AIRTABLE_URL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + encodeURIComponent(AIRTABLE_TABLE);

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
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

  if (!BREVO_API_KEY) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const email = (data.email || '').trim().toLowerCase();
  const firstName = (data.firstName || '').trim();
  const visitorId = (data.visitorId || '').trim();
  const consentTimestamp = data.consentTimestamp || null;

  if (!email || !firstName) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Email and name are required' }) };
  }

  // 1. Add to Brevo
  try {
    const res = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        attributes: { FIRSTNAME: firstName },
        listIds: [BREVO_LIST_ID],
        updateEnabled: true,
      }),
    });
    const body = await res.json();
    const brevoOk = res.status === 201 || res.status === 204 || (res.status === 400 && body.code === 'duplicate_parameter');
    if (!brevoOk) {
      console.error('subscribe: Brevo error', res.status, body);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to add to Brevo' }) };
    }
  } catch(err) {
    console.error('subscribe: Brevo fetch error', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.toString() }) };
  }

  // 2. Patch Airtable if we have a visitorId and API key
  if (visitorId && AIRTABLE_API_KEY) {
    try {
      const atHeaders = {
        'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
        'Content-Type': 'application/json',
      };

      // Check if email already exists under a different visitor ID
      const checkUrl = AIRTABLE_URL
        + '?filterByFormula=' + encodeURIComponent('AND({Email}="' + email + '",{Visitor ID}!="' + visitorId + '")')
        + '&maxRecords=1&fields%5B%5D=Visitor%20ID';
      const checkRes = await fetch(checkUrl, { headers: atHeaders });
      const checkBody = await checkRes.json();
      const linkedVisitorId = (checkBody.records && checkBody.records.length > 0)
        ? checkBody.records[0].fields['Visitor ID']
        : '';

      // Find all records for this visitor
      const searchUrl = AIRTABLE_URL
        + '?filterByFormula=' + encodeURIComponent('{Visitor ID}="' + visitorId + '"');
      const searchRes = await fetch(searchUrl, { headers: atHeaders });
      const searchBody = await searchRes.json();

      if (searchBody.records && searchBody.records.length > 0) {
        const patches = searchBody.records.map(function(r) {
          const fields = { 'Name': firstName, 'Email': email };
          if (consentTimestamp) {
            fields['Email Consent'] = 'Yes';
            fields['Consent Timestamp'] = consentTimestamp;
          }
          if (linkedVisitorId) fields['Linked Visitor ID'] = linkedVisitorId;
          return { id: r.id, fields };
        });

        // Batch in groups of 10 (Airtable limit)
        for (let i = 0; i < patches.length; i += 10) {
          await fetch(AIRTABLE_URL, {
            method: 'PATCH',
            headers: atHeaders,
            body: JSON.stringify({ records: patches.slice(i, i + 10) }),
          });
        }
      }
    } catch(err) {
      console.error('subscribe: Airtable patch error', err);
      // Don't fail the whole request — Brevo succeeded, Airtable patch is best-effort
    }
  }

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
};
