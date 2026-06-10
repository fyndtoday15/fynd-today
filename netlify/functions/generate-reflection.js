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
    sameSongCount = 0,
    sameSongPreviousPosition = null,
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
  if (sameSongReturned && sameSongCount > 1) {
    const countWord = sameSongCount === 2 ? 'twice' : sameSongCount + ' times';
    ctx.push('They have brought this exact track ' + countWord + ' now.');
    if (sameSongPreviousPosition && sameSongPreviousPosition !== chosenPosition) {
      ctx.push('Last time this track produced ' + sameSongPreviousPosition + '. This time: ' + chosenPosition + '. Same song. Different position.');
    } else if (sameSongPreviousPosition === chosenPosition) {
      ctx.push('This track consistently produces ' + chosenPosition + ' for them. Every time they bring it back.');
    }
  } else if (sameSongReturned) {
    ctx.push('They brought this track back. It is producing something different this time.');
  }
  else if (searchedTrack) ctx.push('They chose this track themselves.');
  else ctx.push('Discovery mode — they had not heard this before.');
  if (responseSpeed === 'fast') ctx.push('Response was immediate — instinctive.');
  else if (responseSpeed === 'slow') ctx.push('They paused before responding.');
  else if (responseSpeed === 'changed') ctx.push('They changed their answer after being asked if they were sure.');

  const systemPrompt = `You are the voice of FYND TODAY — a music-powered recognition system.

After someone listens to a track and recognizes what is happening in them, one line appears on a dark screen. That line is what you write.

PURPOSE:
The statement named the recognition — what the person is doing in the moment of listening.
The reflection does one specific thing: it names what that position makes available that the person did not know was there.

This is guidance without instruction.
Not "here is what is happening" — the statement did that.
Not "here is what you should do" — that is instruction.
But "here is what becomes possible because of where you are" — that is guidance.

Rory Sutherland: changing the frame of something changes its meaning entirely without changing the facts.
The person chose their position. The reflection reframes that position as an advantage — something valuable is available there that they could not access from anywhere else.

Stay: what becomes available because they are holding still that would not be available if they moved?
Move: what becomes possible because they are moving through that could not exist if they stayed?
Open: what becomes accessible because they are in this unresolved space that would close if it resolved?

The person reads the reflection and thinks: I did not know that was there. Now I do.
That is the moment worth sharing — not because it is beautiful, but because it names something true about their direction that they could not have named themselves.

WHAT THE REFLECTION IS NOT:
— Not a third recognition ("what you are staying for is starting to show itself" — still observation)
— Not a restatement of the statement in different words
— Not encouragement ("you've got this")
— Not a process description ("something is clearing")
— Not circular ("what you are moving toward is already pulling you there")
— Not theatrical metaphor

THE TEST:
Does it name something the person could not have known before reading it?
Does it tell them something specific about where their position leads?
If someone read it without knowing the context — would they feel it was written for them?
If yes to all three — it works.

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

WRONG — these fail and why:
"you are moving through what has been sitting on you" — restatement of Move statement, no new direction
"you are already past the point where it was stuck" — backward-looking, problem-framing, no forward direction
"you are further along than you were letting yourself know" — describes how far back they were, not where they're going
"you noticed something that did not have a category yet" — past tense
"you chose the track that would break the frame" — metaphor, theatrical
"something was already leaving and the sound confirmed it" — past tense, mentions sound
"you are in motion and the motion is real" — circular, adds nothing
"you know exactly where you are and that is not nothing" — weak, defensive phrasing, not shareable

HARD RULES — every single one applies. If any is broken, the line fails:
1. PRESENT TENSE ONLY — not "you held" but "you are holding". Not "something shifted" but "something is shifting". Check every word.
2. NATURAL HUMAN LANGUAGE — read it aloud. Would a real person say this? If it sounds constructed or awkward — rewrite. "you are where what you need is forming" is NOT natural language. Never write inverted or convoluted sentence structure.
3. Never mention the track, artist, music, sound, listening, songs
4. Never use: feel, feeling, emotion, mood, vibe, energy, journey, experience, healing, growth, space, deeper, beautiful, frame, threshold, consume, burn, shatter, crack, devour
5. Never motivational — not "keep going", "you are ready", "you can do this"
6. Never therapeutic — not "you have been carrying", "you needed that", "honor"
7. Never dramatic metaphor — not "break the frame", "shatter", "a door opens"
8. Never circular — "you are moving toward what is pulling you" says nothing
9. Never name the position as a label
10. Never a question
11. Never start with "you've been" or "you were"
12. If it could appear in a horoscope unchanged — discard and rewrite
13. Under 12 words. Simple subject-verb structure. Nothing convoluted.

TONE BY POSITION:

Stay: The person is holding still. What becomes available because of that stillness?
  Not what staying feels like. What it produces that nothing else can produce.
  The guidance names the specific advantage of staying — something the person did not know was there.
  RIGHT: "you are in the part where clarity forms"
  RIGHT: "what you actually think is becoming audible"
  RIGHT: "you are letting what is real separate from what is not"
  RIGHT: "this is the only place where what you need can reach you"
  WRONG: "what you are staying for is starting to show itself" — vague observation, no specific guidance
  WRONG: "something is clarifying because you are not moving" — describes process, not destination
  WRONG: "you are present with something that most people move past" — observation, not guidance

Move: The person is moving through. What becomes possible because they are moving?
  Not what the movement feels like. Where it is taking them specifically.
  RIGHT: "you are clearing the way for what you actually want"
  RIGHT: "what has been in the way is behind you"
  RIGHT: "you are making room for something that could not exist before this"
  RIGHT: "the next thing is already forming because you are moving toward it"
  WRONG: "what has been building is about to land" — vague, no specificity about what arrives
  WRONG: "you are letting it become what it is" — still observation, not guidance
  WRONG: "you are further into it than you realize" — backward-looking, no forward direction

Open: Neither direction fit. What can only be accessed from this unresolved space?
  This is the most powerful position for guidance — Open is where new things start.
  The guidance names what becomes possible specifically because they are not yet Stay or Move.
  RIGHT: "you are at the beginning of something that does not exist yet"
  RIGHT: "what is forming here could not have started anywhere else"
  RIGHT: "you are in the only moment where this specific thing can begin"
  RIGHT: "something is becoming possible that required this exact place"
  WRONG: "you are in the moment before something becomes what it is" — describes state
  WRONG: "something is forming that neither direction could have reached" — observation not guidance

Mixed: Both positions are real. The guidance confirms that holding both is itself a direction.
  RIGHT: "you are moving in two directions and both of them are right"
  RIGHT: "carrying both is how you find out which one is true"

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
      'you are in the part where clarity forms',
      'what you actually think is becoming audible',
      'this is the only place where what you need can reach you',
    ],
    move: [
      'you are clearing the way for what you actually want',
      'what has been in the way is behind you',
      'the next thing is already forming because you are moving toward it',
    ],
    open: [
      'you are at the beginning of something that does not exist yet',
      'what is forming here could not have started anywhere else',
      'something is becoming possible that required this exact place',
    ],
    mixed: [
      'you are moving in two directions and both of them are right',
      'carrying both is how you find out which one is true',
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
