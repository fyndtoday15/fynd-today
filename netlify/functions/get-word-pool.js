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

A person is about to listen to a specific track. While it plays, a scatter of single words (and occasional 2-word phrases) will fade onto their screen. They tap whichever ones match what this song is doing. This is the recognition mechanic, not a quiz, not a sentence to agree or disagree with. Just raw material they build their own recognition from.

YOUR JOB: research this specific track, its tempo, weight, density, emotional arc, whether it holds still or builds and moves, whether it's predictable or has surprising shifts, and use that research to assemble a pool of exactly 15 words that suit THIS track's character.

THREE POSITIONS THESE WORDS MAP TO (invisible to the user, track internally only):
STAY, holding still, remaining, present with what is, not rushing
MOVE, moving through, releasing, pushing forward, letting go
OPEN, noticing something unexpected, a shift, recognition occurring, off guard

BALANCE IS REQUIRED, NOT OPTIONAL: of the 15 total words, exactly 4 must be Stay, exactly 4 must be Move, exactly 4 must be Open, and exactly 3 must be color words. This 4 and 4 and 4 and 3 split never changes, regardless of the track. The track's character should shape WHICH specific words you pick within each position (a heavy slow track gets heavier feeling Stay words, a driving track gets more urgent Move words) but it must never shrink or skip a position. All three positions always get a real, equal shot at being tapped.

COLOR WORDS, chosen using this fixed logic, not aesthetic guessing:
Color comes from the melody and overall mood of the track only, a separate read from the Stay or Move or Open research above. Use these rules:
Track is heavy, slow, low and serious, pick from: black, red, purple, grey
Track is bright, driving, high energy, pick from: gold, orange, yellow, red
Track is light, soft, delicate, pick from: white, blue, pink, silver
Track is dark, intense, brooding, pick from: black, purple, red, grey
Track is warm, soulful, mid tempo, pick from: orange, gold, brown, green
Pick exactly 3 colors from the single category above that best matches the track's overall mood and melody. Do not mix colors from different categories. Color words carry no position weight at all, they never count toward Stay, Move, or Open, because we cannot know how color affects a person, it is simply an extra option pulled from the song's mood.

Color words must be ONLY from this exact list, no others ever: red, blue, gold, green, purple, white, black, pink, orange, grey, yellow, brown, silver

THE VOCABULARY RULE, THIS IS THE MOST IMPORTANT RULE:
Every single word, including the color words, must be a word an average eight year old already knows and uses, without ever needing it explained. Read every word out loud before including it and ask: would a third grader understand this instantly, with zero hesitation? If there is ANY doubt, do not use it.

BANNED, words like this must never appear, they are too advanced or unclear even though they may seem simple to an adult: restless, caught, suspended, anchored, surfacing, off guard, awake (as a feeling word), loosening, settling, rooting, contained, brooding.

Stick to extremely common, everyday words a child says all the time. Examples of the right difficulty level:
Stay style words: still, quiet, slow, here, calm, safe, soft, waiting
Move style words: forward, fast, going, pulling, rising, faster, ready, pushing
Open style words: new, surprised, different, sudden, strange, fresh, awake, weird

RULES FOR THE WORDS THEMSELVES:
Present moment only, no exceptions, but this is a meaning test, not a spelling test. A word qualifies if it describes a true condition of right now, even if the word's grammatical form looks past tense. "held" is fine because it describes being held right now. "still" is fine. What is not allowed is a word that can only describe something already finished and done, like "ended" or "left" or "finished," where the action is fully over. Test each word by asking, could a kid say this about right now while the song plays? If yes, it qualifies.
Never use a dash or hyphen anywhere in any word, phrase, or surrounding text.
Single words strongly preferred. A 2 word phrase only if a single word truly cannot work.
Never music jargon, never: tempo, beat, rhythm, melody, sound, song.
Never assign emotional content from the track's title or lyrics. Research informs structure only, never assigns what the listener is going through in their life.
Words must work for anyone in any life situation, broad enough to be honestly tappable by many different people for many different reasons.

Respond in JSON only, exactly 15 words/phrases total, 4 stay, 4 move, 4 open, 3 color, each tagged:
{"words": [{"text": "...", "position": "stay|move|open|color"}, ... 15 total]}`;

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
  { text: 'quiet', position: 'stay' },
  { text: 'slow', position: 'stay' },
  { text: 'here', position: 'stay' },
  { text: 'forward', position: 'move' },
  { text: 'fast', position: 'move' },
  { text: 'going', position: 'move' },
  { text: 'pulling', position: 'move' },
  { text: 'new', position: 'open' },
  { text: 'surprised', position: 'open' },
  { text: 'different', position: 'open' },
  { text: 'sudden', position: 'open' },
  { text: 'gold', position: 'color' },
  { text: 'blue', position: 'color' },
  { text: 'red', position: 'color' },
];

function fallbackResponse(allowedOrigin, corsHeaders) {
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ words: FALLBACK_WORDS }) };
}
