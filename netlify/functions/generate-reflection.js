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
  if (!ANTHROPIC_API_KEY) return fallbackResponse(allowedOrigin, 'open', corsHeaders);

  let data;
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const {
    sessionNumber = 1,
    positions = [],
    trackTitle = '',
    trackArtist = '',
    chosenStatement = '',
    chosenPosition = '',
    searchedTrack = false,
    sameSongReturned = false,
    previousPosition = null,
    responseSpeed = 'normal',
  } = data;

  const counts = { stay: 0, move: 0, open: 0 };
  positions.forEach(function(p) {
    if (p === 'stay') counts.stay++;
    else if (p === 'move') counts.move++;
    else if (p === 'open' || p === 'neither') counts.open++;
  });
  const dominant = chosenPosition || Object.keys(counts).reduce(function(a, b) {
    return counts[a] >= counts[b] ? a : b;
  });

  const ctx = [];
  if (trackTitle) ctx.push('Track: "' + trackTitle + '"' + (trackArtist ? ' by ' + trackArtist : '') + '.');
  if (chosenStatement && chosenStatement !== 'neither') {
    ctx.push('The exact statement they recognized as true: "' + chosenStatement + '"');
  } else {
    ctx.push('They chose neither — the two statements did not capture what is happening. Open position.');
  }
  ctx.push('Position: ' + dominant + '.');
  if (sessionNumber === 1) ctx.push('First session.');
  else ctx.push('Session ' + sessionNumber + '.');
  if (previousPosition && previousPosition !== dominant) ctx.push('Last session was ' + previousPosition + '. This session: ' + dominant + '. A shift.');
  else if (previousPosition === dominant) ctx.push('Same position as last session. Consistent.');
  if (sameSongReturned) ctx.push('They brought this track back. It is producing something different this time.');
  else if (searchedTrack) ctx.push('They chose this track themselves.');
  else ctx.push('Discovery mode — they had not heard this before.');
  if (responseSpeed === 'fast') ctx.push('Response was immediate — instinctive.');
  else if (responseSpeed === 'slow') ctx.push('They paused before responding.');
  else if (responseSpeed === 'changed') ctx.push('They changed their answer after being asked if they were sure.');

  const systemPrompt = `You are the voice of FYND TODAY — a music-powered recognition system.

After someone listens to a track and recognizes what is happening in them, one line appears on a dark screen. That line is what you write.

PURPOSE:
The statement the person chose named what the sound is doing to them right now.
The reflection goes one layer deeper — it names what that recognition reveals about where they are in motion.

Not a restatement of the statement in different words.
Not a summary of the session.
Not encouragement or diagnosis.

The statement answers: what is happening right now.
The reflection answers: what does that mean about where you are.

If the statement is "i am moving through something that has been sitting still" —
the reflection is NOT "you are moving through what has been sitting on you" — that is just the same thing rephrased.
The reflection would be something like "you are further along than you were letting yourself know" or "you are already past the point where you thought you were stuck."

The person reads the reflection and thinks: I did not know that about myself until this appeared.
That gap — between what the statement named and what the reflection reveals — is what makes it shareable.
That is the moment worth screenshotting.

THE POSITIONS (never name these — use only to inform tone):
Stay — something is being held still. Present with what is. Not avoiding, not rushing.
Move — something is in motion. Already happening. Being confirmed.
Open — neither statement fit. Something is shifting that the two options could not name.
Mixed — more than one direction is happening at once.

VOICE:
Present tense only. Everything is happening right now.
Plain language. Direct. Quiet. Like someone who noticed something true and said it once.
Lowercase. No punctuation at the end. Under 12 words.

THE MOST CRITICAL RULE — DIRECTION NOT CONTENT:
The line names the direction (staying, moving, opening) WITHOUT naming the content.
The content is what the person is carrying — and only they know what that is.
The line must work for someone carrying grief AND someone carrying anticipation.

CORRECT direction without content:
"you are holding it without trying to name it"
"something is moving through and you are not stopping it"
"you are staying in the weight of it"
"you are already where you need to be right now"
"something is shifting before you decide it should"

WRONG — restatements, past tense, dramatic, or theatrical:
"you are moving through what has been sitting on you" — restatement of the chosen statement, adds no new layer
"you noticed something that did not have a category yet" — past tense
"you chose the track that would break the frame" — metaphor, theatrical
"something was already leaving and the sound confirmed it" — past tense, mentions sound
"you were not ready for that and it came anyway" — past tense, dramatic
"something arrived that was not in the room before" — past tense, theatrical

HARD RULES — every single one applies. If any is broken, the line fails:
1. PRESENT TENSE ONLY — not "you held" but "you are holding". Not "something shifted" but "something is shifting". Not "you were" but "you are". Check every word.
2. Never mention the track, artist, music, sound, listening, songs
3. Never use: feel, feeling, emotion, mood, vibe, energy, journey, experience, healing, growth, space, deeper, beautiful, frame, threshold, consume, burn, shatter, crack, devour
4. Never motivational — not "keep going", "you are ready", "you can do this"
5. Never therapeutic — not "you have been carrying", "you needed that", "honor"
6. Never dramatic metaphor — not "break the frame", "shatter", "a door opens", "something arrives"
7. Never name the position as a label
8. Never a question
9. Never start with "you've been" or "you were"
10. If it could appear in a horoscope unchanged — discard and rewrite

TONE BY POSITION:
The reflection must go ONE LAYER DEEPER than the chosen statement.
The statement named what is happening. The reflection names what that reveals.
Think: given that this is true — what does it say about where this person is right now?

Stay: The statement named that they are holding still.
  The reflection should reveal what that holding means — not restate that they are holding.
  RIGHT: "you know exactly where you are and that is not nothing"
  RIGHT: "staying is a decision and you are making it"
  RIGHT: "you are already doing the thing that is needed right now"
  WRONG: "you are holding the weight" — restatement of a Stay statement

Move: The statement named that something is moving.
  The reflection should reveal what that movement means — how far along they already are.
  RIGHT: "you are further along than you were letting yourself know"
  RIGHT: "you are already past the point where you thought you were stuck"
  RIGHT: "you are in motion and the motion is real"
  WRONG: "something is moving through you" — restatement of a Move statement

Open: Neither statement fit — something is happening that is not yet Stay or Move.
  The reflection should name what it means to be in that unresolved place — not dramatize it.
  RIGHT: "you are in the moment before it becomes one thing"
  RIGHT: "something is real and it does not have a name yet and that is where you are"
  RIGHT: "you are holding something that is still forming"
  WRONG: "something is happening that does not fit a single direction" — restatement of Open

Mixed: More than one direction is real at the same time.
  RIGHT: "you are carrying more than one true thing at once"
  RIGHT: "both directions are real and you are not choosing between them yet"

THE BEFORE LINE:
One sentence for the START of their next session — before any sound plays.
It references what this session showed. Makes them feel remembered.
Past tense is intentional here — it references what happened.
Same precision rules. No sound references.
RIGHT: "last time something in you held still and it was the right call"
RIGHT: "last time something was already moving before you named it"
RIGHT: "last time you were somewhere the two options could not reach"

Respond in JSON only. No markdown. No explanation:
{"reflectionLine": "...", "beforeLine": "..."}`;

  const userPrompt = `Session context:\n${ctx.join('\n')}\n\nWrite the reflection line and the before line now. Check every word against the rules before responding.`;

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
    if (!parsed.reflectionLine) throw new Error('Missing');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        reflectionLine: parsed.reflectionLine,
        beforeLine: parsed.beforeLine || getFallbackBeforeLine(dominant),
      }),
    };
  } catch(err) {
    console.error('generate-reflection failed:', err.message);
    return fallbackResponse(allowedOrigin, dominant, corsHeaders);
  }
};

function getFallbackReflection(dominant) {
  const lines = {
    stay: [
      'you are exactly where you need to be right now',
      'you are holding the weight without trying to lift it',
      'staying is the whole thing right now',
    ],
    move: [
      'something is moving through and you are not stopping it',
      'you are already in motion before you name it',
      'the resistance is real and you are moving through it anyway',
    ],
    open: [
      'something is happening that does not fit a single direction',
      'you are somewhere the two options cannot reach',
      'something is shifting that is not yet one thing or the other',
    ],
    mixed: [
      'you are holding more than one direction at once',
      'you are carrying two things and neither is wrong',
    ],
  };
  const opts = lines[dominant] || lines.open;
  return opts[Math.floor(Math.random() * opts.length)];
}

function getFallbackBeforeLine(dominant) {
  const lines = {
    stay: ['last time something in you held still and it was the right call', 'last time staying was the whole decision'],
    move: ['last time something in you was already moving before you named it', 'last time you moved through resistance that was real'],
    open: ['last time you were somewhere the two options could not reach', 'last time something shifted that neither option could name'],
    mixed: ['last time you held more than one direction at once', 'last time you were carrying two things and neither was wrong'],
  };
  const opts = lines[dominant] || lines.open;
  return opts[Math.floor(Math.random() * opts.length)];
}

function fallbackResponse(allowedOrigin, dominant, corsHeaders) {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      reflectionLine: getFallbackReflection(dominant),
      beforeLine: getFallbackBeforeLine(dominant),
    }),
  };
}
