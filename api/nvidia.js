/**
 * NVIDIA API Proxy - Vercel Serverless Function
 * Forwards AI chatbot requests to NVIDIA API with secure API key
 */

export default async function handler(req, res) {
  // Enable CORS for your frontend domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight first
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    console.error('[NVIDIA Proxy] Missing NVIDIA_API_KEY environment variable');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { model, messages, max_tokens, temperature, top_p, stream } = req.body;

    // Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: messages required' });
    }

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify({
        model: model || 'meta/llama-3.1-8b-instruct',
        messages,
        max_tokens: max_tokens || 150,
        temperature: temperature ?? 0.2,
        top_p: top_p ?? 0.8,
        stream: stream ?? true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[NVIDIA Proxy] API Error:', response.status, errorText);
      return res.status(response.status).json({
        error: `NVIDIA API error: ${response.status}`,
        details: errorText.substring(0, 500),
      });
    }

    // Forward the response headers
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/event-stream');

    // Stream the response back to client
    const reader = response.body.getReader();
    const encoder = new TextEncoder();

    // Disable response buffering for streaming
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }

    res.end();

  } catch (error) {
    console.error('[NVIDIA Proxy] Error:', error.message);
    return res.status(500).json({
      error: 'Failed to proxy request to NVIDIA API',
      message: error.message,
    });
  }
}
