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
The statement named what is happening right now — what the sound is doing to the person.
The reflection does something different. It names the direction of movement that the chosen position makes available.

Three things the reflection must do simultaneously:
1. Confirm the position with agency — the person chose this, they are not being swept. They are driving their experience.
2. Point toward what the position makes possible — not what is happening, but where it leads.
3. Land as a sudden, clear insight — the person reads it once and thinks: yes, that is exactly where I am going.

This is Rory Sutherland's reframing principle applied precisely:
A small change in how something is framed completely changes its meaning and emotional response.
The statement described the present moment.
The reflection reframes that moment as direction — it makes the person feel agency over where they are.

The person should read it and feel seen in a way that makes them want to show someone else.
That is what makes it shareable — not beauty, not poetry. Recognition of something true about their direction.
Self-relevance: it confirms who they are right now.
Social relevance: it expresses something they want others to know about them.

WHAT THE REFLECTION IS NOT:
— Not a second recognition — the statement already did that. The reflection does not describe what is happening.
— Not a restatement ("you are holding the pace when everything else is rushing" when they chose to let something build — that is still observation, not direction)
— Not a description of the past
— Not encouragement ("you've got this", "keep going")
— Not a diagnosis ("you are in a Stay state")
— Not theatrical or metaphorical

THE TEST: does the reflection answer "where does this lead?" not "what is happening?"
If it describes the present moment — it fails. It must point toward what the position makes possible.

CIRCULAR LINES FAIL — these say nothing:
"what you are moving toward is already pulling you there" — circular, tautological, no information
"you are going where you are going" — same problem
"what is happening is what is happening" — same
If the line could be its own opposite without changing meaning — discard it.

The line must name something SPECIFIC that the position produces or leads toward.
Not a process. An arrival. Something that becomes true BECAUSE of this position.

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

TONE BY POSITION — what the reflection does for each:

Stay: Staying is a choice. The reflection names what that choice is making possible — not what staying feels like.
  Ask: what will this stillness produce? What opens up because they stayed?
  RIGHT: "what you are staying for is becoming clearer"
  RIGHT: "you are making room for what can only arrive slowly"
  RIGHT: "what you are in is becoming something you can name"
  RIGHT: "something is clarifying because you are not moving away from it"
  WRONG: "you are holding the pace when everything else is rushing" — describes the staying, not where it leads
  WRONG: "you are present with something that most people move past" — observation, not direction

Move: Moving is already happening. The reflection names where it is going — not that it is happening.
  Ask: what is this movement building toward? What arrives because they moved?
  RIGHT: "what has been building is about to land"
  RIGHT: "you are letting it become what it is"
  RIGHT: "something is arriving that the movement is making room for"
  RIGHT: "the releasing is making space for what comes in"
  WRONG: "you are making room for what comes next" — vague, no specific arrival
  WRONG: "something is clearing as you move through it" — describes the motion, not the destination

Open: Neither direction fit. The reflection names what becomes available in that unresolved space.
  Ask: what can only happen here — in the space between Stay and Move?
  RIGHT: "something is forming that neither direction could have reached"
  RIGHT: "what is arriving does not have a name yet and it does not need one"
  RIGHT: "you are in the only place where this specific thing can happen"
  WRONG: "you are in the moment before something becomes what it is" — describes the state, not what it produces

Mixed: Both directions are real. The reflection confirms that multiplicity as productive.
  RIGHT: "both of what you are carrying are moving you forward"
  RIGHT: "you are in more than one place and both are taking you somewhere"

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
      'what you are staying for is becoming clearer',
      'you are making room for what can only arrive slowly',
      'something is clarifying because you are not moving away from it',
    ],
    move: [
      'what has been building is about to land',
      'you are letting it become what it is',
      'the releasing is making space for what comes in',
    ],
    open: [
      'something is forming that neither direction could have reached',
      'what is arriving does not have a name yet and it does not need one',
      'you are in the only place where this specific thing can happen',
    ],
    mixed: [
      'both of what you are carrying are moving you forward',
      'you are in more than one place and both are taking you somewhere',
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
