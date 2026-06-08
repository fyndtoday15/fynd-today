const https = require('https');

const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

function httpsPost(url, headers, body) {
  return new Promise(function(resolve, reject) {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }, headers),
    };
    const req = https.request(options, function(res) {
      let raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async function(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return fallbackResponse(allowedOrigin, corsHeaders);
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { title = '', artist = '' } = data;

  if (!title && !artist) {
    return fallbackResponse(allowedOrigin, corsHeaders);
  }

  // ── SYSTEM PROMPT ─────────────────────────────────────────────────────────
  // Claude researches the specific track and writes two statements
  // that are structurally true to what that song actually does to people.
  // Not mood labels. Not genre descriptions. Felt directions.
  const systemPrompt = `You are working for FYND TODAY — a music-powered recognition system built around three positions: Stay, Move, and Open.

Your job: research a specific track and write TWO statements that describe what that track structurally does to a person while listening. These statements appear on screen after the track plays. The person picks the one that is more true for them right now — or neither.

THE THREE POSITIONS (internal reference only — never use these words in output):
— Stay: the track holds the listener still. Something settles. Stillness confirmed.
— Move: the track pulls the listener forward or through something. Momentum confirmed.
— Open: the track shifts something that wasn't there before. A door. Space. Noticing.

YOUR TWO STATEMENTS:
Statement A should lean toward Stay — something that grounds, settles, holds, remains.
Statement B should lean toward Move — something that pulls, lifts, propels, shifts forward.

The person picking neither implies Open — the track opened something that neither statement captures.

RULES:
— Research the actual track. Know its tempo, texture, tone, energy arc, lyrical direction if any.
— Write from what the track structurally DOES — not what it is about or what genre it belongs to.
— Both statements must be in first person: "i felt..." or "something..."
— Each statement: 5-8 words maximum. Short. Landed. No trailing off.
— Lowercase. No punctuation at the end.
— Never use: emotion, mood, feel, vibe, energy, journey, healing, space, beautiful, amazing
— Never describe the music itself — describe what happens to the person
— Never be so generic the statements could apply to any track
— The statements should feel like they were written for THIS track specifically
— Both must be genuinely plausible responses to this track — not one obviously right, one obviously wrong

EXAMPLES for a slow, heavy, grounding track:
A: "something in me stopped moving"
B: "i felt the weight shift forward"

EXAMPLES for a building, forward-moving track:
A: "i stayed exactly where i was"
B: "something started pulling me through"

EXAMPLES for an unexpected, textured track:
A: "it held me where i already was"
B: "i moved somewhere i didn't plan"

Respond in JSON only:
{"statementA": "...", "statementB": "..."}`;

  const userPrompt = `Track: "${title}" by ${artist}

Research this track. Write the two recognition statements for it now. JSON only.`;

  try {
    const result = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 150,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }
    );

    if (result.status !== 200) {
      console.error('Claude API error:', result.status, JSON.stringify(result.body));
      return fallbackResponse(allowedOrigin, corsHeaders);
    }

    const raw = result.body;
    const text = (raw.content && raw.content[0] && raw.content[0].text)
      ? raw.content[0].text.trim()
      : '';

    if (!text) {
      return fallbackResponse(allowedOrigin, corsHeaders);
    }

    let parsed;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch(e) {
      console.error('JSON parse failed:', text);
      return fallbackResponse(allowedOrigin, corsHeaders);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        statementA: parsed.statementA || FALLBACK_PAIRS[0][0],
        statementB: parsed.statementB || FALLBACK_PAIRS[0][1],
      }),
    };

  } catch(err) {
    console.error('get-statements error:', err);
    return fallbackResponse(allowedOrigin, corsHeaders);
  }
};

// ── FALLBACKS ─────────────────────────────────────────────────────────────────
const FALLBACK_PAIRS = [
  ['something in me got quieter', 'something started moving'],
  ['i felt held where i was', 'i felt pulled somewhere'],
  ['it settled something', 'it shifted something'],
  ['i stayed inside it', 'it took me somewhere'],
  ['something in me slowed', 'something in me lifted'],
];

function fallbackResponse(allowedOrigin, corsHeaders) {
  const pair = FALLBACK_PAIRS[Math.floor(Math.random() * FALLBACK_PAIRS.length)];
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      statementA: pair[0],
      statementB: pair[1],
    }),
  };
}
