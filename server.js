const http = require("http");
const https = require("https");
const { HttpsProxyAgent } = require("https-proxy-agent");

const PORT = process.env.PORT || 3000;
const PROXY = "http://qijlkvsz-rotate:viryx2zv5njj@p.webshare.io:80";
const REFERER = "https://anikoto.to/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
};

function doProxy(target) {
  return new Promise((resolve, reject) => {
    const agent = new HttpsProxyAgent(PROXY);
    const url = new URL(target);
    https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        Referer: REFERER,
        Origin: "https://anikoto.to",
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      agent,
    }, resolve).on("error", reject).end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = new URL(req.url, "http://" + req.headers.host);
  const target = url.searchParams.get("url");

  if (!url.pathname.startsWith("/proxy") || !target) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end("Use /proxy?url=https://...");
  }

  try {
    const up = await doProxy(target);
    const ct = up.headers["content-type"] || "";
    const h = { ...CORS };
    if (up.headers["content-length"]) h["content-length"] = up.headers["content-length"];
    if (up.headers["content-range"]) h["content-range"] = up.headers["content-range"];

    // m3u8 — rewrite all segment/key/map URLs back to /proxy
    if (ct.includes("mpegurl") || ct.includes("m3u8") || target.endsWith(".m3u8")) {
      const chunks = [];
      for await (const c of up) chunks.push(c);
      let m3u8 = Buffer.concat(chunks).toString();
      const base = target.substring(0, target.lastIndexOf("/") + 1);

      function toProxy(raw) {
        let full;
        if (raw.startsWith("http")) full = raw;
        else if (raw.startsWith("/")) full = new URL(raw, target).href;
        else full = base + raw;
        return "/proxy?url=" + encodeURIComponent(full);
      }

      // Rewrite URI="..." in #EXT-X-KEY, #EXT-X-MAP
      m3u8 = m3u8.replace(/URI="([^"]+)"/g, (_m, uri) => 'URI="' + toProxy(uri) + '"');

      // Rewrite standalone segment/playlist lines
      m3u8 = m3u8.split("\n").map(line => {
        const t = line.trim();
        if (!t || t.startsWith("#")) return line;
        return toProxy(t);
      }).join("\n");

      h["content-type"] = "application/vnd.apple.mpegurl";
      h["cache-control"] = "no-cache";
      res.writeHead(200, h);
      return res.end(m3u8);
    }

    // Everything else — stream through
    h["content-type"] = ct;
    res.writeHead(up.statusCode || 200, h);
    up.pipe(res);

  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => console.log("Running on :" + PORT));
