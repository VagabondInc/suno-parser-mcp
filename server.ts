// server.ts — Vercel/Node server for parsing Suno.com song pages
// Extracts song metadata from embedded JSON without requiring browser automation
// Package.json deps: { "fastify": "^4.26.2" }

import Fastify from "fastify";

const fastify = Fastify({ logger: false });

fastify.get("/parse", async (req, reply) => {
  const url = String((req.query as any)?.url || "");
  if (!url || !/^https?:\/\/(www\.)?suno\.com\/song\/[a-f0-9-]+$/i.test(url)) {
    reply.code(400).send({ error: "Provide a valid suno.com song URL at /song/<id>" });
    return;
  }

  try {
    // Fetch the HTML page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Extract JSON data from Next.js __NEXT_DATA__ script
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
    let songData = null;
    
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // Navigate through Next.js data structure to find song info
        const pageProps = nextData?.props?.pageProps;
        songData = pageProps?.song || pageProps?.data;
      } catch (e) {
        // Fall back to regex extraction if JSON parsing fails
      }
    }
    
    // Fallback: Extract data using regex patterns
    let title = songData?.title || null;
    let artist = songData?.display_name || songData?.user?.display_name || null;
    let lyrics = songData?.metadata?.prompt || null;
    let styles = songData?.metadata?.tags || null;
    
    // Additional fallback extractions from HTML if JSON data incomplete
    if (!title) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
      title = titleMatch ? titleMatch[1].replace(' | Suno', '').trim() : null;
    }
    
    if (!lyrics && html.includes('Lyrics')) {
      // Try to extract lyrics from visible text patterns
      const lyricsMatch = html.match(/Lyrics[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/);
      if (lyricsMatch) {
        lyrics = lyricsMatch[1].replace(/<[^>]+>/g, '').trim() || null;
      }
    }
    
    if (!styles && html.includes('Style')) {
      // Try to extract styles from visible text patterns
      const stylesMatch = html.match(/Style[s]?[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/);
      if (stylesMatch) {
        styles = stylesMatch[1].replace(/<[^>]+>/g, '').trim() || null;
      }
    }
    
    // Clean up extracted text
    function clean(s?: string | null) {
      return s
        ?.replace(/\u00a0/g, ' ')
        ?.replace(/<[^>]+>/g, '')
        ?.replace(/\s+/g, ' ')
        ?.replace(/\n{3,}/g, '\n\n')
        ?.trim() || null;
    }
    
    // Provide debug info
    const rawHtmlSnippet = html.slice(0, 2000);
    
    reply.send({
      url,
      title: clean(title),
      artist: clean(artist),
      lyrics: clean(lyrics),
      styles: clean(styles),
      rawHtmlSnippet,
      songData: songData ? JSON.stringify(songData).slice(0, 500) : null // Debug info
    });
  } catch (err: any) {
    reply.code(500).send({ error: "Failed to fetch or parse page", details: err?.message });
  }
});

// Health and OpenAPI file passthrough if hosting spec here
fastify.get("/", async (_req, reply) => reply.send({ ok: true }));
fastify.get("/openapi.yaml", async (_req, reply) => {
  // If serving the spec from the same host, paste the YAML string here or read from file.
  reply.type("text/yaml").send(`# paste the openapi.yaml content here`);
});

fastify.listen({ port: Number(process.env.PORT) || 3000, host: "0.0.0.0" }).catch((err) => {
  console.error(err);
  process.exit(1);
});