// server.ts — Vercel/Node server with Playwright (Chromium) to render and scrape SPA pages
// Deploy on Vercel or any Node host. Ensure Playwright Chromium is installed.
// Package.json deps: { "playwright": "^1.46.0", "fastify": "^4.26.2" }

import Fastify from "fastify";
import { chromium } from "playwright";

const fastify = Fastify({ logger: false });

fastify.get("/parse", async (req, reply) => {
  const url = String((req.query as any)?.url || "");
  if (!url || !/^https?:\/\/(www\.)?suno\.com\/song\/[a-f0-9-]+$/i.test(url)) {
    reply.code(400).send({ error: "Provide a valid suno.com song URL at /song/<id>" });
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await context.newPage();

    // Navigate and wait for network to settle to catch SPA content
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 60000 });

    // Heuristic selectors: Suno's UI may change; we search by text labels first.
    // Grab title/artist if available
    const title = await page.title().catch(() => null);

    // Try to locate an obvious artist/name element
    const artist =
      (await page.locator('a[href^="/artist/"], a[href*="/user/"]').first().textContent().catch(() => null)) ||
      (await page.locator('[data-testid*="artist"], [class*="artist"]').first().textContent().catch(() => null)) ||
      null;

    // Find "Lyrics" and "Style(s)" sections by header text
    async function extractSection(labelTexts: string[]) {
      for (const label of labelTexts) {
        const heading = page.locator(`:text("${label}")`).first();
        if (await heading.count()) {
          // Try sibling/parent containers to gather text content
          const container = heading.locator("xpath=..");
          const next = container.locator("xpath=following-sibling::*").first();
          const text =
            (await next.textContent().catch(() => null)) ||
            (await container.textContent().catch(() => null));
          if (text) return clean(text.replace(label, ""));
        }
      }
      // Fallback: search for elements whose innerText includes the label
      const candidate = page.locator("body *").filter({ hasText: new RegExp(labelTexts.join("|"), "i") }).first();
      if (await candidate.count()) return clean((await candidate.textContent().catch(() => "")) || "");
      return null;
    }

    function clean(s?: string | null) {
      return s
        ?.replace(/\u00a0/g, " ")
        ?.replace(/\s+\n/g, "\n")
        ?.replace(/\n{3,}/g, "\n\n")
        ?.trim() || null;
    }

    const lyrics = await extractSection(["Lyrics", "LYRICS"]);
    const styles = await extractSection(["Style", "Styles", "STYLE", "STYLES"]);

    // Provide a short HTML snippet for debugging if needed
    const rawHtmlSnippet = await page.evaluate(() => document.body.innerHTML.slice(0, 2000)).catch(() => null);

    await context.close();
    await browser.close();

    reply.send({
      url,
      title: title || null,
      artist: artist ? artist.trim() : null,
      lyrics,
      styles,
      rawHtmlSnippet,
    });
  } catch (err: any) {
    if (browser) await browser.close().catch(() => {});
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