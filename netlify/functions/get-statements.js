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
  if (!ANTHROPIC_API_KEY) return fallbackResponse(allowedOrigin, corsHeaders);

  let data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { title = '', artist = '' } = data;
  if (!title && !artist) return fallbackResponse(allowedOrigin, corsHeaders);

  const systemPrompt = `You are writing for FYND TODAY — a music-powered recognition system.

After someone listens to a track, two short statements appear on screen. The person picks the one that is more true for them right now — or neither if neither fits.

WHAT THESE STATEMENTS ARE:
They describe what is happening inside a person while listening to this specific track.
They are NOT about the music. They are about the person.
The person reads them and one either fits or it does not.

THE TWO DIRECTIONS:
Statement A leans toward stillness — staying, holding, remaining, grounding.
Statement B leans toward movement — shifting forward, releasing, moving through.
Neither = something opened that these two cannot name.

HOW TO WRITE THEM:
Use the track's structural qualities — tempo, texture, weight, whether it builds or holds — to inform which direction each statement leans and how strongly. That is all the track research is for.

Write in plain natural language. First person. Present tense only.
One complete thought. 8-12 words. Lowercase. No punctuation at the end.

THE TWO RULES THAT MATTER MOST:

RULE 1 — THE PERSON IS THE SUBJECT, THE SOUND IS THE CONTEXT:
The statement is about what the PERSON is doing — not what the sound is doing to them.
The sound creates the moment. The person is choosing how to be in it.

WRONG — sound as subject:
"i am letting it hold me in place" — the sound is holding them. They are passive.
"i am letting it move me" — the sound is moving them. They are passive.
"i am riding it forward" — they are riding the sound. Sound-focused.

RIGHT — person as subject:
"i am staying in this instead of following where it pulls" — person choosing to stay
"i am staying with what is here instead of reaching for what comes next" — person's choice
"i am moving through this instead of waiting for it to pass" — person's action
"i am letting what is building continue instead of stopping it" — person allowing, not being acted upon

The statement names what the person is doing IN the moment of listening.
The track informs whether that choice leans toward staying or moving.
"this" refers to the moment — not the sound specifically, not a named feeling.

RULE 2 — DIRECTION NOT CONTENT:
The track tells you the DIRECTION (settling vs moving).
The person brings the CONTENT (what they are carrying).
The statement names the direction without naming the content.
Works for someone carrying grief AND someone carrying nothing in particular.

WRONG: "i am sitting with what is hurting" — names the content
WRONG: "i am letting myself burn through what is holding me back" — names the content AND uses metaphor
RIGHT: "i am staying in it instead of pushing through" — direction only, no content

HARD RULES:
1. Present tense ONLY
2. Must feel anchored to the listening experience — "it" or "this" refers to what the sound is doing
3. No dramatic language — not "consume", "burn", "shatter", "devour", "break free"
4. No metaphors about fire, burning, breaking, cracking, doors, paths, travel
5. No assigning emotional content — not "hurt", "pain", "fear", "grief", "loss"
6. Both statements genuinely plausible for this track — not one obviously right
7. Statement A leans toward staying/grounding. Statement B leans toward moving/releasing.
8. Neither so specific it only works for one emotional state

Respond in JSON only. No markdown:
{"statementA": "...", "statementB": "..."}`;

  const userPrompt = `Track: "${title}" by ${artist}

Research this track's structural qualities — tempo, texture, weight, energy arc.
Use that to calibrate how strongly each statement leans in its direction.
Write the two recognition statements now. JSON only.`;

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
    if (result.status !== 200) throw new Error('API ' + result.status);
    const text = (result.body.content && result.body.content[0] && result.body.content[0].text)
      ? result.body.content[0].text.trim() : '';
    if (!text) throw new Error('Empty');
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  }

  try {
    let parsed;
    try { parsed = await callClaude(); }
    catch(e) { console.log('Retry:', e.message); parsed = await callClaude(); }
    if (!parsed.statementA || !parsed.statementB) throw new Error('Missing');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ statementA: parsed.statementA, statementB: parsed.statementB }),
    };
  } catch(err) {
    console.error('get-statements failed:', err.message);
    return fallbackResponse(allowedOrigin, corsHeaders);
  }
};

const FALLBACK_PAIRS = [
  ['i am sitting with it instead of trying to move through it', 'something is shifting and i am letting it'],
  ['i am staying in the weight of it', 'i am moving through something that has been sitting still'],
  ['i am recognizing something i have been carrying without naming it', 'i am letting something go that i have been holding'],
  ['i am not trying to resolve it — just staying here', 'something is moving forward and i am moving with it'],
];

function fallbackResponse(allowedOrigin, corsHeaders) {
  const pair = FALLBACK_PAIRS[Math.floor(Math.random() * FALLBACK_PAIRS.length)];
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ statementA: pair[0], statementB: pair[1] }),
  };
}
