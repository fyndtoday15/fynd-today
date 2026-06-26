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
    console.error('subscribe: BREVO_API_KEY not set');
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

  // 1. Check if contact already exists in Brevo
  let alreadyExists = false;
  try {
    const checkRes = await fetch('https://api.brevo.com/v3/contacts/' + encodeURIComponent(email), {
      method: 'GET',
      headers: { 'api-key': BREVO_API_KEY },
    });
    if (checkRes.status === 200) {
      alreadyExists = true;
    }
  } catch(err) {
    console.warn('subscribe: Brevo check error (non-fatal):', err);
  }

  // 2. Add to Brevo only if new — don't overwrite existing contacts
  if (!alreadyExists) {
    try {
      const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          attributes: { FIRSTNAME: firstName },
          listIds: [BREVO_LIST_ID],
          updateEnabled: false,
        }),
      });

      let brevoBody = null;
      if (brevoRes.status !== 204) {
        try { brevoBody = await brevoRes.json(); } catch(e) {}
      }

      const brevoOk = brevoRes.status === 201 || brevoRes.status === 204 || brevoRes.status === 200;
      if (!brevoOk) {
        console.error('subscribe: Brevo error', brevoRes.status, brevoBody);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to add contact', detail: brevoBody && brevoBody.message }) };
      }
      console.log('subscribe: Brevo contact created for', email);

      // Send welcome email (template 1) — new subscribers only, best effort
      try {
        const welcomeRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateId: 1,
            to: [{ email: email, name: firstName || '' }],
          }),
        });
        console.log('subscribe: welcome email sent, status', welcomeRes.status);
      } catch(e) {
        console.warn('subscribe: welcome email failed (non-fatal):', e);
      }
    } catch(err) {
      console.error('subscribe: Brevo fetch error', err);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.toString() }) };
    }
  } else {
    console.log('subscribe: contact already exists in Brevo:', email);
  }

  // 2. Patch Airtable — best effort, never fails the request
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

        for (let i = 0; i < patches.length; i += 10) {
          await fetch(AIRTABLE_URL, {
            method: 'PATCH',
            headers: atHeaders,
            body: JSON.stringify({ records: patches.slice(i, i + 10) }),
          });
        }
        console.log('subscribe: Airtable patched', patches.length, 'records for visitorId', visitorId);
      }
    } catch(err) {
      console.error('subscribe: Airtable patch error (non-fatal):', err);
    }
  }

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, alreadyExists }) };
};
