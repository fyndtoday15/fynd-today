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

  // ── CALL 1: RESEARCH THE TRACK AND BUILD A WORD POOL ────────────────────────
  // This pool feeds the tap-to-recognize interaction during listening.
  // The person taps whichever words feel true to them right now — no sentences,
  // no forced binary choice. Each word is invisibly tagged to a position so we
  // can tally their picks later, but the person never sees position labels.

  const systemPrompt = `You are building a word pool for FYND TODAY — a music-powered recognition system.

A person is about to listen to a specific track. While it plays, a scatter of single words (and occasional 2-word phrases) will fade onto their screen. They tap whichever ones feel true to what is happening in them right now. This is the recognition mechanic — not a quiz, not a sentence to agree or disagree with. Just raw material they build their own recognition from.

YOUR JOB: research this specific track — its tempo, weight, density, emotional arc, whether it holds still or builds and moves, whether it's predictable or has surprising shifts — and use that research to assemble a pool of 10 words that suit THIS track's character.

THREE POSITIONS THESE WORDS MAP TO (invisible to the user — track internally only):
STAY — holding still, remaining, present with what is, not rushing
MOVE — moving through, releasing, pushing forward, letting go
OPEN — noticing something unexpected, a shift, recognition occurring, off-guard

Pick words/short phrases for each position that suit what THIS track structurally does. A heavy, slow, contained track should pull more naturally toward Stay-leaning words being prominent in the pool. A driving, building track pulls toward Move-leaning words. A track with unpredictable shifts, genre changes, or surprising turns pulls toward Open-leaning words. The pool should still include some words from all three categories (never zero from any one position) but the proportion and the chosen specific words should be shaped by the actual track.

ALSO INCLUDE 2 COLOR WORDS — actual color names (red, blue, gold, green, purple, amber, silver, violet, crimson, teal, white, black, pink, orange, grey) that suit this track's character. These render visually IN that color on screen, so the person can recognize a color instantly, the same fast way they recognize a Stay/Move/Open word — no interpretation needed, just "yes, that one." Pick colors that genuinely suit the track's tone (a heavy, dark, contained track might pull toward black, crimson, violet; a bright, driving track might pull toward gold, orange, teal). These carry no position weight — they only add tonal flavor to the eventual output, but must be ACTUAL color names, never mood words like "warm" or "heavy" standing in for a color.

RULES FOR THE WORDS THEMSELVES:
— Single words preferred. Occasional 2-word phrases only if a single word doesn't work (e.g. "not yet" for Open).
— Plain, ordinary, human words. Not clinical, not poetic, not music jargon (never: tempo, beat, rhythm, melody, sound, song).
— Never assign emotional content from the track's title or lyrics. Research informs STRUCTURE (does it hold or move or surprise), never assigns what the listener is going through in their life.
— Words must work for someone in any life situation — broad enough to be honestly tappable by many different people for many different reasons.
— Color words must be from this exact list only: red, blue, gold, green, purple, amber, silver, violet, crimson, teal, white, black, pink, orange, grey

EXAMPLE WORD BANKS BY POSITION (style reference — generate your own fitting this specific track, do not reuse these verbatim every time):
Stay-style: still, held, quiet, steady, grounded, settled, here, slow, anchored, present, rooted, paused
Move-style: forward, pulling, lifting, going, building, rising, reaching, faster, ahead, loosening, releasing
Open-style: unexpected, shift, surprised, different, sudden, awake, cracked open, strange, fresh, off guard, surfacing, new

Respond in JSON only — exactly 10 words/phrases total (mix of stay/move/open/color), each tagged:
{"words": [{"text": "...", "position": "stay|move|open|color"}, ... 10 total]}`;

  const userPrompt = `Track: "${title}" by ${artist}

Research this track's structural character. Build the 10-word pool now. JSON only.`;

  async function callClaude() {
    const result = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-sonnet-4-5', max_tokens: 400, system: systemPrompt,
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
    if (!parsed.words || !Array.isArray(parsed.words) || parsed.words.length < 6) throw new Error('Bad word pool');
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ words: parsed.words }) };
  } catch(err) {
    console.error('get-word-pool failed:', err.message);
    return fallbackResponse(allowedOrigin, corsHeaders);
  }
};

// ── FALLBACK WORD POOL ─────────────────────────────────────────────────────────
// Balanced default pool used only if the API is unreachable.
const FALLBACK_WORDS = [
  { text: 'still', position: 'stay' },
  { text: 'held', position: 'stay' },
  { text: 'quiet', position: 'stay' },
  { text: 'forward', position: 'move' },
  { text: 'pulling', position: 'move' },
  { text: 'building', position: 'move' },
  { text: 'unexpected', position: 'open' },
  { text: 'shift', position: 'open' },
  { text: 'gold', position: 'color' },
  { text: 'blue', position: 'color' },
];

function fallbackResponse(allowedOrigin, corsHeaders) {
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ words: FALLBACK_WORDS }) };
}
