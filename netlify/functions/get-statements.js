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

THREE POSSIBLE POSITIONS — every track maps to exactly two of these three:
STAY — the person is holding their position. Staying in something. Not pushing through yet. Present with what is.
MOVE — the person is moving through something. Releasing, pushing forward, letting go.
OPEN — the person is just becoming aware of something. Recognition is occurring. Something shifted and they are still inside the moment of noticing.

YOUR FIRST JOB — RESEARCH AND DECIDE:
Research the track's structural qualities — tempo, weight, density, how it builds or doesn't, whether it resolves or stays suspended, whether it has a clear forward motion or sits in stillness, whether it's emotionally direct or more disorienting/unexpected.

Based on that research, decide which TWO of the three positions (Stay, Move, Open) are most plausible for someone listening to this specific track. Not every track is a Stay-vs-Move track. Some tracks are more naturally Stay-vs-Open (a track that either holds you still or catches you off guard). Some are Move-vs-Open (a track that either pushes you forward or opens something unexpected). Choose the pair that genuinely fits this track's character — don't default to Stay-vs-Move out of habit.

THE THIRD POSITION NOT REPRESENTED becomes available as "neither" — so across many sessions, all three positions should appear as direct statement options roughly equally, not just Stay and Move with Open always relegated to "neither."

WHAT THE STATEMENTS ARE:
First-person recognition statements describing what the person is doing — never what the sound is doing to them.
The track informs which two positions are plausible. The person brings the content. Never assign emotional content from the track title or lyrics.

CRITICAL RULE:
Do NOT infer emotional content from the track title, lyrics, or artist.
"Bad Romance" does not mean the person is in a bad romance.
The track title tells you structural qualities of the sound. Not what the person is experiencing in their life.

HOW TO WRITE EACH POSITION AS A STATEMENT:
Stay: "i am staying in this instead of [pushing through / reaching for what's next / resolving it]"
Move: "i am moving through this even though [it is not easy / part of it is unresolved]"
Open: "i am noticing something i did not expect" / "something just shifted and i am still in it" / "i did not see that coming and i am still right here in it"

LENGTH: one sentence, 8-14 words, complete thought, natural everyday language. Lowercase. No punctuation at the end.

BANNED WORDS: loop, pulse, beat, rhythm, tempo, flow, wave, frequency, tone, melody, sound, music, song, track, listen, riding, surfing, burning, doors, paths, energy, space, vibe, healing, journey, emotion, feeling.

EXAMPLES OF RIGHT REGISTER:

For a heavy, contained, emotionally weighted track (Stay vs Move fits):
A: "i am staying in this instead of pushing through it"
B: "i am moving through this even though it is not easy"

For a track that is steady and grounded but has one unexpected shift in it (Stay vs Open fits):
A: "i am staying with what is familiar here"
B: "something just caught me off guard and i am still in it"

For an unpredictable, genre-shifting, or surprising track (Move vs Open fits):
A: "i am moving with this and not slowing down"
B: "i did not expect that and i am still taking it in"

Respond in JSON only — include which two positions you chose:
{"positionA": "stay|move|open", "statementA": "...", "positionB": "stay|move|open", "statementB": "..."}`;

  const userPrompt = `Track: "${title}" by ${artist}

Research this track. Decide which two of the three positions (stay, move, open) fit it best. Write the two recognition statements. JSON only.`;

  async function callClaude() {
    const result = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-sonnet-4-5', max_tokens: 250, system: systemPrompt,
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
    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({
        statementA: parsed.statementA,
        statementB: parsed.statementB,
        positionA: parsed.positionA || 'stay',
        positionB: parsed.positionB || 'move',
      }),
    };
  } catch(err) {
    console.error('get-statements failed:', err.message);
    return fallbackResponse(allowedOrigin, corsHeaders);
  }
};

// Fallbacks cycle through all three pairings so Open isn't permanently absent
const FALLBACK_SETS = [
  { positionA: 'stay', statementA: 'i am staying in this instead of pushing through it',
    positionB: 'move', statementB: 'i am moving through this even though it is not easy' },
  { positionA: 'stay', statementA: 'i am staying with what is familiar here',
    positionB: 'open', statementB: 'something just caught me off guard and i am still in it' },
  { positionA: 'move', statementA: 'i am moving with this and not slowing down',
    positionB: 'open', statementB: 'i did not expect that and i am still taking it in' },
];

function fallbackResponse(allowedOrigin, corsHeaders) {
  const set = FALLBACK_SETS[Math.floor(Math.random() * FALLBACK_SETS.length)];
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(set) };
}
