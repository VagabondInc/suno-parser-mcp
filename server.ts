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

// Full JSON extraction endpoint
fastify.get("/extract", async (req, reply) => {
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
    
    if (!nextDataMatch) {
      reply.code(404).send({ error: "No Next.js data found on page" });
      return;
    }
    
    let nextData;
    try {
      nextData = JSON.parse(nextDataMatch[1]);
    } catch (e) {
      reply.code(500).send({ error: "Failed to parse Next.js JSON data", details: e.message });
      return;
    }
    
    // Extract and organize the data nicely
    const pageProps = nextData?.props?.pageProps;
    const song = pageProps?.song || pageProps?.data;
    
    // Structure the response with organized sections
    const organizedData = {
      url,
      extraction_timestamp: new Date().toISOString(),
      
      // Core song information
      song_info: {
        id: song?.id,
        title: song?.title,
        display_name: song?.display_name,
        created_at: song?.created_at,
        status: song?.status,
        model_name: song?.model_name,
        gpt_description_prompt: song?.gpt_description_prompt
      },
      
      // User/Artist information
      user_info: {
        id: song?.user?.id,
        display_name: song?.user?.display_name,
        handle: song?.user?.handle,
        avatar_image_url: song?.user?.avatar_image_url,
        is_verified: song?.user?.is_verified
      },
      
      // Audio and media URLs
      media: {
        audio_url: song?.audio_url,
        video_url: song?.video_url,
        image_url: song?.image_url,
        image_large_url: song?.image_large_url
      },
      
      // Metadata and generation details
      metadata: {
        prompt: song?.metadata?.prompt,
        gpt_description_prompt: song?.metadata?.gpt_description_prompt,
        audio_prompt_id: song?.metadata?.audio_prompt_id,
        history: song?.metadata?.history,
        concat_history: song?.metadata?.concat_history,
        type: song?.metadata?.type,
        duration: song?.metadata?.duration,
        refund_credits: song?.metadata?.refund_credits,
        stream: song?.metadata?.stream,
        error_type: song?.metadata?.error_type,
        error_message: song?.metadata?.error_message,
        tags: song?.metadata?.tags
      },
      
      // Engagement metrics
      engagement: {
        play_count: song?.play_count,
        upvote_count: song?.upvote_count,
        is_liked: song?.is_liked,
        reaction: song?.reaction
      },
      
      // Technical details
      technical: {
        duration: song?.duration,
        is_trashed: song?.is_trashed,
        is_public: song?.is_public,
        stem_from_id: song?.stem_from_id,
        infill_start_s: song?.infill_start_s,
        infill_end_s: song?.infill_end_s
      },
      
      // Raw Next.js data for debugging
      raw_next_data: {
        props: nextData?.props,
        page: nextData?.page,
        query: nextData?.query,
        buildId: nextData?.buildId,
        isFallback: nextData?.isFallback,
        gssp: nextData?.gssp
      },
      
      // Full song object
      full_song_data: song
    };
    
    reply.send(organizedData);
    
  } catch (err: any) {
    reply.code(500).send({ error: "Failed to fetch or extract data", details: err?.message });
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