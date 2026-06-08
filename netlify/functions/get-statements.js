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
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { title = '', artist = '' } = data;
  if (!title && !artist) {
    return fallbackResponse(allowedOrigin, corsHeaders);
  }

  const systemPrompt = `You are working for FYND TODAY — a music-powered recognition system.

After someone listens to a track, two statements appear on screen. The person picks whichever one is more true for them right now — or neither.

These are NOT descriptions of the music. They are descriptions of what can happen inside a person while listening to this specific track. The person reads them and one of them either fits or it doesn't. That recognition is the whole point.

TWO POSITIONS THE STATEMENTS REPRESENT:
Statement A — something settled, held still, stayed, grounded. The person remained where they were.
Statement B — something moved, shifted forward, lifted, or pushed through. The person was pulled somewhere.

If neither fits — that's the third option. Something opened that these two can't name.

HOW TO WRITE THEM:
Research the track. Know its tempo, texture, tone, the arc of how it builds or doesn't build, whether it holds space or creates momentum.

Write two statements that a real person could genuinely feel after listening to that specific track. Both must be plausible — not one obviously right and one obviously wrong. The track should be able to produce either response depending on where the person is that day.

Write in plain, natural language. First person. How a person actually talks.
Not poetic. Not metaphorical. Not clinical. Just honest and specific to this track.

Length: one complete thought. 6-12 words. Long enough to feel true, short enough to land immediately.

Lowercase. No punctuation at the end.

WHAT MAKES A GOOD STATEMENT PAIR:
— Both feel like real things a person could think or say after this track
— They are clearly different directions — one settling, one moving
— Neither one sounds like a lyric, a caption, or a motivational quote
— A person reading them immediately knows which one fits (or that neither does)
— They are specific enough that you could not swap them in for a completely different track

WHAT TO AVOID:
— Metaphors about places, travel, destinations, doors, paths
— The words: journey, space, heal, beautiful, deep, vibe, energy
— Describing the music — never say what the song does, say what the person experienced
— Anything that sounds like a therapy prompt or an Instagram caption
— Fragments that feel incomplete
— Both statements leaning the same direction
— Assigning specific emotional content — never name what the weight IS, what hurt, what was lost
  The track tells you the DIRECTION (settling vs moving). The person brings the CONTENT.
  Right: "i sat with what i was carrying and didn't try to put it down" — direction without content
  Wrong: "i sat with something that hurt and didn't try to fix it" — assigns emotional content
  The statement must work for someone who brought grief AND for someone who brought anticipation.
  Same direction. Different content. That's the calibration.

STRONG EXAMPLES (study these — this is the register to hit):

For a slow, atmospheric, emotionally heavy track:
A: "i sat with what i was carrying and didn't try to put it down"
B: "something in me loosened and i let it go"

For an urgent, driving, forward-moving track:
A: "i stayed in the tension instead of moving through it"
B: "i felt myself catch up to something i was already reaching for"

For a track with a lot of space and restraint:
A: "i stopped trying to figure out where i was and just stayed there"
B: "it pushed something through that had been sitting still"

For an emotionally direct, confessional track:
A: "i recognized something i had been holding without naming it"
B: "it moved something that was ready to go"

Respond in JSON only. No markdown. No explanation:
{"statementA": "...", "statementB": "..."}`;

  const userPrompt = `Track: "${title}" by ${artist}

Research this track carefully. Write the two recognition statements for someone who just listened to it. JSON only.`;

  async function callClaude() {
    const result = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }
    );

    if (result.status !== 200) {
      throw new Error('API returned ' + result.status);
    }

    const text = (result.body.content && result.body.content[0] && result.body.content[0].text)
      ? result.body.content[0].text.trim() : '';

    if (!text) throw new Error('Empty response');

    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  }

  try {
    let parsed;
    try {
      parsed = await callClaude();
    } catch(firstErr) {
      console.log('First attempt failed, retrying:', firstErr.message);
      parsed = await callClaude();
    }

    if (!parsed.statementA || !parsed.statementB) {
      throw new Error('Missing statements in response');
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        statementA: parsed.statementA,
        statementB: parsed.statementB,
      }),
    };

  } catch(err) {
    console.error('get-statements failed:', err.message);
    return fallbackResponse(allowedOrigin, corsHeaders);
  }
};

// ── FALLBACKS ─────────────────────────────────────────────────────────────────
// Only fire if API completely unreachable.
// Written to the same standard — natural, specific, plausible.
const FALLBACK_PAIRS = [
  [
    'i sat with it instead of trying to move through it',
    'something shifted and i let it',
  ],
  [
    'i recognized something i had been holding without naming it',
    'it moved something that was ready to go',
  ],
  [
    'i stayed in the weight of it',
    'i felt myself catch up to something i was already reaching for',
  ],
  [
    'i stopped trying to figure out where i was and stayed there',
    'it pushed something forward that had been sitting still',
  ],
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
