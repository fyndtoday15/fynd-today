const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

exports.handler = async function(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const query = (data.query || '').trim();
  if (!query || query.length < 2) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ error: 'Query too short' }),
    };
  }

  try {
    // Search YouTube for music tracks
    const searchUrl = 'https://www.googleapis.com/youtube/v3/search'
      + '?part=snippet'
      + '&q=' + encodeURIComponent(query + ' official audio')
      + '&type=video'
      + '&videoCategoryId=10'  // Music category
      + '&maxResults=6'
      + '&key=' + YOUTUBE_API_KEY;

    const res = await fetch(searchUrl);
    const ytData = await res.json();

    if (!res.ok) {
      console.error('YouTube API error:', ytData);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ error: 'YouTube API error', detail: ytData.error?.message }),
      };
    }

    if (!ytData.items || ytData.items.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ results: [] }),
      };
    }

    // Map to clean track objects
    const results = ytData.items.map(item => ({
      id: item.id.videoId,
      title: cleanTitle(item.snippet.title),
      artist: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.default?.url || '',
    }));

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ results }),
    };

  } catch(err) {
    console.error('search-tracks error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ error: err.toString() }),
    };
  }
};

// Clean common YouTube title noise
function cleanTitle(title) {
  return title
    .replace(/\(Official (Audio|Video|Music Video|Lyric Video|Visualizer)\)/gi, '')
    .replace(/\[Official (Audio|Video|Music Video|Lyric Video|Visualizer)\]/gi, '')
    .replace(/\(Audio\)/gi, '')
    .replace(/\[Audio\]/gi, '')
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\[Lyrics\]/gi, '')
    .replace(/ft\./gi, 'ft.')
    .trim();
}
