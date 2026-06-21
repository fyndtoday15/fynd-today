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
  if (!ANTHROPIC_API_KEY) {
    console.error('get-word-pool: ANTHROPIC_API_KEY not set, using fallback');
    return fallbackResponse(allowedOrigin, corsHeaders);
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { title = '', artist = '' } = data;
  if (!title && !artist) {
    console.error('get-word-pool: no title or artist provided, using fallback');
    return fallbackResponse(allowedOrigin, corsHeaders);
  }

  // ── CALL 1: RESEARCH THE TRACK AND BUILD A WORD POOL ────────────────────────
  // This pool feeds the tap-to-recognize interaction during listening.
  // The person taps whichever words feel true to them right now — no sentences,
  // no forced binary choice. Each word is invisibly tagged to a position so we
  // can tally their picks later, but the person never sees position labels.

  const systemPrompt = `You are building a word pool for FYND TODAY — a music-powered recognition system.

A person is about to listen to a specific track. While it plays, a scatter of single words (and occasional 2-word phrases) will fade onto their screen. They tap whichever ones match what this song is doing. This is the recognition mechanic, not a quiz, not a sentence to agree or disagree with. Just raw material they build their own recognition from.

YOUR JOB: research this specific track, its tempo, weight, density, emotional arc, whether it holds still or builds and moves, whether it's predictable or has surprising shifts, and use that research to assemble a pool of exactly 15 words that suit THIS track's character.

THREE POSITIONS THESE WORDS MAP TO (invisible to the user, track internally only):
STAY, holding still, remaining, present with what is, not rushing
MOVE, moving through, releasing, pushing forward, letting go
OPEN, noticing something unexpected, a shift, recognition occurring, off guard

BALANCE IS REQUIRED, NOT OPTIONAL: of the 15 total words, exactly 5 must be Stay, exactly 5 must be Move, exactly 5 must be Open. This 5 and 5 and 5 split never changes, regardless of the track. The track's character should shape WHICH specific words you pick within each position (a heavy slow track gets heavier feeling Stay words, a driving track gets more urgent Move words) but it must never shrink or skip a position. All three positions always get a real, equal shot at being tapped.

THE VOCABULARY RULE, THIS IS THE MOST IMPORTANT RULE:
Every single word must be a word an average eight year old already knows and uses, without ever needing it explained. Read every word out loud before including it and ask: would a third grader understand this instantly, with zero hesitation? If there is ANY doubt, do not use it.

BANNED, words like this must never appear, they are too advanced or unclear even though they may seem simple to an adult: restless, suspended, anchored, surfacing, awake (as a feeling word), loosening, settling, rooting, contained, brooding, off guard, double take, stopped short, thrown, tilted.

VARIETY MATTERS: the lists below are a large pool of acceptable words at the right difficulty level, not a short list to pick the same five from every time. Pull different combinations for different tracks. Two different songs should rarely produce the exact same 5 words for a position unless they are genuinely very similar tracks. Reach across the full list, not just the first few words that come to mind.

Stay style words, pick from this wide pool, do not default to the same 5 every time: still, quiet, slow, here, calm, safe, soft, resting, steady, peaceful, gentle, easy, warm, cozy, settled, patient, paused, holding, staying, slowing down, grounded, not going anywhere, staying put, sitting with it, not rushing
Move style words, pick from this wide pool. Every word here describes the plain, simple feeling of moving forward toward a next thing, the same plain everyday register as the Stay words above, not dramatic, not a specific physical action like running or racing, just forward motion toward what comes next.
The full flat Move list to choose from: forward, ready, loose, drawn forward, moving, carrying, going, ahead, pulling, unstuck, onward, reaching, coming, heading, approaching, toward, next, closing in, leaving, arriving, continuing, advancing, passing through, on track, departing

Open style words, pick from this wide pool. Every word here describes the plain, simple feeling of the mind opening, noticing something new, or seeing something differently, the same plain everyday register as the Stay words above, not dramatic, not clinical, just the ordinary feeling of becoming aware of something.
The full flat Open list to choose from: new, different, curious, clicking into place, rethinking, fresh, surprised, awakened, alert, shifting, change, noticing, clicking, dawning, realizing, getting it, changing, turning, different than before, switching, wondering, paying attention, waking up, looking again, seeing it now

RULES FOR THE WORDS THEMSELVES:
Present moment only, no exceptions, but this is a meaning test, not a spelling test. A word qualifies if it describes a true condition of right now, even if the word's grammatical form looks past tense. "held" is fine because it describes being held right now. "still" is fine. What is not allowed is a word that can only describe something already finished and done, like "ended" or "left" or "finished," where the action is fully over. Test each word by asking, could a kid say this about right now while the song plays? If yes, it qualifies.
Never use a dash or hyphen anywhere in any word, phrase, or surrounding text.
Single words strongly preferred. A 2 word phrase only if a single word truly cannot work.
Never music jargon, never: tempo, beat, rhythm, melody, sound, song.
Never assign emotional content from the track's title or lyrics. Research informs structure only, never assigns what the listener is going through in their life.
Words must work for anyone in any life situation, broad enough to be honestly tappable by many different people for many different reasons.

Respond in JSON only, exactly 15 words/phrases total, 5 stay, 5 move, 5 open, each tagged:
{"words": [{"text": "...", "position": "stay|move|open"}, ... 15 total]}`;

  const userPrompt = `Track: "${title}" by ${artist}

Research this track's structural character. Build the 15-word pool now. JSON only.`;

  async function callClaude() {
    const result = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-sonnet-4-5', max_tokens: 700, system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }] }
    );
    if (result.status !== 200) {
      console.error('get-word-pool: Claude API returned', result.status, JSON.stringify(result.body));
      throw new Error('API ' + result.status);
    }
    const text = (result.body.content && result.body.content[0] && result.body.content[0].text) ? result.body.content[0].text.trim() : '';
    if (!text) throw new Error('Empty');
    try {
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch(parseErr) {
      console.error('get-word-pool: failed to parse Claude response as JSON:', text);
      throw parseErr;
    }
  }

  try {
    let parsed;
    try { parsed = await callClaude(); }
    catch(e) { console.log('get-word-pool: first attempt failed, retrying:', e.message); parsed = await callClaude(); }
    if (!parsed.words || !Array.isArray(parsed.words) || parsed.words.length < 6) {
      console.error('get-word-pool: word pool failed validation, got:', JSON.stringify(parsed));
      throw new Error('Bad word pool');
    }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ words: parsed.words }) };
  } catch(err) {
    console.error('get-word-pool: all attempts failed, using fallback. Reason:', err.message);
    return fallbackResponse(allowedOrigin, corsHeaders);
  }
};

// ── FALLBACK WORD POOL ─────────────────────────────────────────────────────────
// Balanced default pool used only if the API is unreachable.
const FALLBACK_WORDS = [
  { text: 'still', position: 'stay' },
  { text: 'quiet', position: 'stay' },
  { text: 'slow', position: 'stay' },
  { text: 'here', position: 'stay' },
  { text: 'calm', position: 'stay' },
  { text: 'forward', position: 'move' },
  { text: 'ready', position: 'move' },
  { text: 'going', position: 'move' },
  { text: 'pulling', position: 'move' },
  { text: 'onward', position: 'move' },
  { text: 'new', position: 'open' },
  { text: 'surprised', position: 'open' },
  { text: 'different', position: 'open' },
  { text: 'curious', position: 'open' },
  { text: 'noticing', position: 'open' },
];

function fallbackResponse(allowedOrigin, corsHeaders) {
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ words: FALLBACK_WORDS }) };
}
