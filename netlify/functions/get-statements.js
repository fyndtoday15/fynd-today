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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return fallbackResponse(allowedOrigin, corsHeaders);

  let data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { title = '', artist = '' } = data;
  if (!title && !artist) return fallbackResponse(allowedOrigin, corsHeaders);

  const systemPrompt = `You are writing recognition statements for FYND TODAY — a music-powered system that identifies how sound positions people.

After someone listens to a track, two statements appear. The person picks the one that is true for them right now — or neither.

WHAT THE STATEMENTS ARE:
These are first-person recognition statements. The person reads them and one either fits or it doesn't.
They describe what the person is doing — how they are relating to what they are in right now.
They do NOT describe the music, the sound, the song, or the listening experience.
The track informs the direction (holding vs moving), but the statement is about the person.

THE TWO DIRECTIONS:
Statement A: the person is holding their position — staying in something, not pushing through it yet
Statement B: the person is moving through something — releasing, pushing forward, letting go

If neither fits — that's valid. It means something else is happening (the Open position).

HOW TO WRITE THEM:
Research the track. Understand its structural qualities — does it hold space or create momentum? Is it heavy and contained or building and releasing? That tells you which direction each statement leans and how strongly.

Write two statements in plain, natural, everyday first-person language.
The kind of thing a person might actually say or think.
Not poetic. Not clever. Not constructed. Just honest.

LENGTH: one sentence. 8-14 words. Complete thought. Not a fragment.

CRITICAL RULE — THE MOST IMPORTANT ONE:
Do NOT infer emotional content from the track title, lyrics, or artist.
"Bad Romance" does not mean the person is in a bad romance.
"Burn Beautiful" does not mean the person is burning or in pain.
"Lose Control" does not mean the person is losing control.
The track title and artist tell you the structural qualities of the sound — tempo, weight, momentum.
They do NOT tell you what the person is experiencing in their life.
Statements that assign life context from track titles are wrong every time.

WRONG:
"i am staying in what i know even though part of me wants out" — inferred from "Bad Romance" lyrics
"i am walking away from this instead of waiting anymore" — inferred from song content
"i am letting myself feel this even though it hurts" — assigned emotional content

RIGHT:
"i am staying in this instead of pushing through it" — no life context, pure position
"i am moving through this even though it is not comfortable" — no life context, pure position

BANNED WORDS AND CONCEPTS — if any appear, rewrite:
Music vocabulary: loop, pulse, beat, rhythm, tempo, flow, wave, frequency, tone, melody, sound, music, song, track, listen
Metaphors: riding, surfing, waves, fire, burning, doors, paths, roads, frames, breaking through
Emotional content from lyrics: anything that references the song's subject matter, storyline, or title meaning
Abstract nouns: energy, space, vibe, healing, journey, experience, emotion, feeling
Therapy language: carrying, holding on, letting go of pain, processing, healing

WHAT GOOD STATEMENTS LOOK LIKE:
They name a specific human position — something a person can recognize as true or not true for them right now.
Both must be genuinely plausible for someone listening to this specific track.
Neither one should be obviously "better" — both are valid human positions.

EXAMPLES OF RIGHT REGISTER:
For a slow, heavy, emotionally weighted track:
A: "i am staying in this instead of pushing through it"
B: "i am ready to move through this even if it is not comfortable"

For an urgent, building, forward-moving track:
A: "i am taking this slowly even though it wants to move fast"
B: "i am moving with this and not holding back"

For a raw, confessional, emotionally direct track:
A: "i am sitting with what is true instead of looking away"
B: "i am naming what is real and moving past it"

WRONG — do not write like this:
"i am letting it loop without needing it to resolve" — "it" is the sound, music vocabulary (loop)
"i am riding the pulse forward" — riding + pulse = music metaphors
"i am letting it move through me" — passive, sound as actor, vague "it"
"i am staying in the weight of it" — vague "it" with no referent

Respond in JSON only. No markdown:
{"statementA": "...", "statementB": "..."}`;

  const userPrompt = `Track: "${title}" by ${artist}

Research this track. Write two recognition statements for someone who just listened to it. JSON only.`;

  async function callClaude() {
    const result = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-sonnet-4-5', max_tokens: 200, system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }] }
    );
    if (result.status !== 200) throw new Error('API ' + result.status);
    const text = (result.body.content && result.body.content[0] && result.body.content[0].text) ? result.body.content[0].text.trim() : '';
    if (!text) throw new Error('Empty');
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  }

  try {
    let parsed;
    try { parsed = await callClaude(); }
    catch(e) { console.log('Retry:', e.message); parsed = await callClaude(); }
    if (!parsed.statementA || !parsed.statementB) throw new Error('Missing statements');
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ statementA: parsed.statementA, statementB: parsed.statementB }) };
  } catch(err) {
    console.error('get-statements failed:', err.message);
    return fallbackResponse(allowedOrigin, corsHeaders);
  }
};

const FALLBACK_PAIRS = [
  ['i am staying in this instead of pushing through it', 'i am moving through this even though it is not easy'],
  ['i am taking this in slowly', 'i am letting what wants to move actually move'],
  ['i am staying with what is here', 'i am moving through what is here'],
  ['i am not rushing this', 'i am not holding this back'],
];

function fallbackResponse(allowedOrigin, corsHeaders) {
  const pair = FALLBACK_PAIRS[Math.floor(Math.random() * FALLBACK_PAIRS.length)];
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ statementA: pair[0], statementB: pair[1] }) };
}
