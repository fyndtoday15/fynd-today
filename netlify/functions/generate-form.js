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
  if (!ANTHROPIC_API_KEY) return fallbackResponse(allowedOrigin, 'stay', corsHeaders);

  let data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const {
    trackTitle = '',
    trackArtist = '',
    tappedWords = [],       // [{text, position}, ...] — real Stay/Move/Open recognition words only
    tappedColors = [],      // [{text, position:'color'}, ...] — color words, never count toward position
    dominantPosition = '',  // 'stay' | 'move' | 'open' | 'mixed' — computed by portal from tally
    hasHistory = false,     // have they brought this exact track before?
    historyCount = 0,       // how many times total (including this one)
    historyPreviousPosition = null, // what position won last time for this track
  } = data;

  const tappedList = tappedWords.map(function(w) { return w.text; }).join(', ');
  const tappedColorList = tappedColors.map(function(w) { return w.text; }).join(', ');
  const sameAsLast = hasHistory && historyPreviousPosition === dominantPosition;
  const differentFromLast = hasHistory && historyPreviousPosition && historyPreviousPosition !== dominantPosition;

  // ── BUILD CONTEXT FOR CLAUDE ────────────────────────────────────────────────
  const ctx = [];
  if (trackTitle) ctx.push('Track: "' + trackTitle + '"' + (trackArtist ? ' by ' + trackArtist : '') + '.');
  ctx.push('Words they tapped: ' + (tappedList || 'none') + '.');
  ctx.push('Dominant position from their taps: ' + dominantPosition + '.');
  if (tappedColorList) {
    ctx.push('They also tapped these colors: ' + tappedColorList + '. These are pulled from the song\'s mood only and carry zero weight toward the position. Optional, light flavor only if it genuinely fits, never required.');
  }

  if (!hasHistory) {
    ctx.push('First time bringing this exact track. No history to compare.');
  } else if (sameAsLast) {
    ctx.push('They have brought this track ' + historyCount + ' times. Same position every relevant time: ' + dominantPosition + '. This is a confirmed pattern with this song.');
  } else if (differentFromLast) {
    ctx.push('They have brought this track before. Last time: ' + historyPreviousPosition + '. This time: ' + dominantPosition + '. The same song is moving them differently now.');
  }

  // ── SYSTEM PROMPT ─────────────────────────────────────────────────────────
  const systemPrompt = `You are the voice of FYND TODAY — a music-powered recognition system.

A person just listened to a track and tapped words that felt true to what was happening in them. You are writing the FORM — the thing they carry forward. This is not a summary of what they felt. They already know what they felt; that was the recognition step. Your job is different and has up to two parts:

ON COLOR, IF ANY WAS TAPPED: a color word may appear separately in the context below. It is pulled from the song's mood only, never from the person, and it never counts toward Stay, Move, or Open in any way. You may let it lightly color your word choice in the challenge if it genuinely fits without effort, for example reaching for a slightly warmer or cooler word naturally. Never mention the color directly, never build the challenge around it, never let it override or compete with the real tapped words. If using it would force anything, ignore it completely.

PART 1 — THE MEMORY LINE (only if history exists, otherwise skip entirely):
If this is the first time with this track, skip this part completely — write nothing for it.
If they have brought this exact track before, write one short line reporting the comparison plainly. Same position as before, or different. This is genuinely unique information only this system can produce, because it required remembering this specific track and this specific person over time.
Examples of the right register:
"third time staying with this one"
"last time this moved you. today it's holding you still"
"this one keeps doing the same thing to you"
Keep it under 10 words. Plain. No drama. State the fact of the pattern or the shift.

PART 2 — THE CHALLENGE (always required):
A short, casual dare that pushes them to carry today's position into the next thing they do. Not advice. Not affirmation. A challenge — like something a friend would text, not a wellness app.

Tone: blend of three things —
(a) blunt and universal enough to apply to literally any person in any life situation
(b) a little playful, a little confident, some personality
(c) casual texting voice, lowercase, no ending punctuation, contractions fine, reads like something a person would actually type to a friend
(d) NEVER use a dash or hyphen anywhere in the output, no exceptions
(e) PRESENT TENSE ONLY, this is about today, right now, never yesterday or tomorrow

Never formal. Never therapeutic. Never explain the position. Never say "stay," "move," or "open" as words. Never use: journey, energy, space, vibe, heal, feel, feeling, emotion.

CLARITY IS NON NEGOTIABLE: every challenge must be instantly understandable on first read, the same plain everyday register as the word pool itself. No metaphor, no abstraction, no clever wordplay that requires a second read to parse. If a person has to stop and think "wait, what does that mean," it has failed, no matter how clever it sounds. Say the plain, direct thing.

BAD EXAMPLES, never write like this, these are confusing or too abstract even though they may sound poetic:
"pick the version of today that feels most like a question mark" — nobody knows what this means, too abstract, fails instantly
"let the unfinished thing stay unfinished a while longer" — vague, no clear action
"chase the shape of what's next" — metaphorical, unclear
"hand today over to whatever it wants to become" — abstract, no concrete instruction
Anything using "version of," "shape of," "feels like," or similar abstract framing devices — these almost always produce confusing output, avoid this sentence pattern entirely.

If they have a CONFIRMED REPEATED PATTERN with this track (same position multiple times), the challenge should escalate slightly — acknowledge the pattern is real and dare them to trust it on something bigger, rather than repeating the same small dare as a first-timer would get.

EXAMPLES OF THE RIGHT CHALLENGE REGISTER BY POSITION:

Stay (first time): "don't rush whatever's next, you're not behind"
Stay (confirmed pattern, 3rd+ time): "you keep choosing to stay here, trust that on something bigger today"
Stay (different texture, warm/steady words): "stay in it a little longer, no one's timing you"

Move (first time): "go finish the thing you keep circling"
Move (confirmed pattern): "you always move through this one, stop waiting for permission elsewhere"
Move (different texture, loud/rising words): "let it pull you somewhere loud for once"

Open (first time): "say yes to the next weird thing, on purpose"
Open (confirmed pattern): "this one always catches you off guard, let something else catch you too"
Open (mixed with stay-leaning word): "let this one stay unresolved a little longer"

Mixed (tapped words spread across positions evenly): "you're carrying two directions right now, that's allowed"

Pull the actual texture from the words they tapped — don't default to the generic first-time version if the specific words suggest a different flavor (warmth, urgency, surprise, etc).

Respond in JSON only:
{"memoryLine": "... or empty string if no history", "challenge": "..."}`;

  const userPrompt = 'Context:\n' + ctx.join('\n') + '\n\nWrite the form now. JSON only.';

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
    if (!parsed.challenge) throw new Error('No challenge in response');
    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({
        memoryLine: parsed.memoryLine || '',
        challenge: parsed.challenge,
      }),
    };
  } catch(err) {
    console.error('generate-form failed:', err.message);
    return fallbackResponse(allowedOrigin, dominantPosition || 'stay', corsHeaders);
  }
};

// ── FALLBACKS ─────────────────────────────────────────────────────────────────
function getFallbackChallenge(position) {
  const lines = {
    stay: ["don't rush whatever's next, you're not behind", 'stay in it a little longer, no one is timing you'],
    move: ['go finish the thing you keep circling', "let it pull you somewhere loud for once"],
    open: ["say yes to the next weird thing, on purpose", 'let this one stay unresolved a little longer'],
    mixed: ["you're carrying two directions right now, that's allowed"],
  };
  const opts = lines[position] || lines.stay;
  return opts[Math.floor(Math.random() * opts.length)];
}

function fallbackResponse(allowedOrigin, position, corsHeaders) {
  return {
    statusCode: 200, headers: corsHeaders,
    body: JSON.stringify({ memoryLine: '', challenge: getFallbackChallenge(position) }),
  };
}
