const http = require("http");
const https = require("https");
const { HttpsProxyAgent } = require("https-proxy-agent");

const PORT = process.env.PORT || 3000;
const PROXY = "http://qijlkvsz-rotate:viryx2zv5njj@p.webshare.io:80";
const REFERER = "https://anikoto.to/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
};

function proxyFetch(target, method, extra, body) {
  return new Promise((resolve, reject) => {
    const agent = new HttpsProxyAgent(PROXY);
    const url = new URL(target);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        Referer: REFERER,
        Origin: "https://anikoto.to",
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      agent,
    }, resolve);
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

const SKIP = [
  "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com",
  "fonts.googleapis.com", "fonts.gstatic.com",
];

function shouldSkip(d) {
  return SKIP.some(s => d === s || d.endsWith("." + s));
}

function rewrite(text) {
  text = text.replace(
    /https?:\\\/\\\/([^\\\/"']+)((?:\\\/|[^"'\s\r\n])*)/g,
    (_m, d, r) => {
      const c = r.replace(/\\\//g, "/");
      if (d === "megaplay.buzz") return c.replace(/\//g, "\\/");
      if (shouldSkip(d)) return _m;
      return ("/cdn/" + d + c).replace(/\//g, "\\/");
    }
  );
  text = text.replace(
    /https?:\/\/([^\/\s"']+)([^\s\r\n"'"]*)/g,
    (_m, d, pq) => {
      if (d === "megaplay.buzz") return pq;
      if (shouldSkip(d)) return _m;
      return "/cdn/" + d + pq;
    }
  );
  return text;
}

function reply(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body === null) return res.end();
  if (typeof body === "string") return res.end(body);
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return reply(res, 204, CORS, null);

  const url = new URL(req.url, "http://" + req.headers.host);

  try {
    // ===== /cdn/DOMAIN/path =====
    if (url.pathname.startsWith("/cdn/")) {
      const full = url.pathname.replace("/cdn/", "");
      const idx = full.indexOf("/");
      if (idx === -1) {
        return reply(res, 400, { ...CORS, "content-type": "application/json" }, { error: "bad path" });
      }
      const host = full.substring(0, idx);
      const p = full.substring(idx);
      const target = "https://" + host + p + url.search;

      const up = await proxyFetch(target, "GET", {});
      const ct = up.headers["content-type"] || "";
      const h = { ...CORS };
      for (const k of ["content-type", "content-length", "content-range"]) {
        if (up.headers[k]) h[k] = up.headers[k];
      }

      // m3u8 — rewrite segments to absolute CDN URLs
      if (ct.includes("mpegurl") || ct.includes("m3u8") || p.endsWith(".m3u8")) {
        let m3u8 = (await readAll(up)).toString();
        const base = target.substring(0, target.lastIndexOf("/") + 1);

        m3u8 = m3u8.split("\n").map(line => {
          const t = line.trim();
          if (!t || t.startsWith("#")) {
            if (t.includes('URI="')) {
              return t.replace(/URI="([^"]+)"/g, function(_m, uri) {
                if (uri.startsWith("http")) return 'URI="' + uri + '"';
                if (uri.startsWith("/")) return 'URI="https://' + host + uri + '"';
                return 'URI="' + base + uri + '"';
              });
            }
            return line;
          }
          if (t.startsWith("http")) return line;
          if (t.startsWith("/")) return "https://" + host + t;
          return base + t;
        }).join("\n");

        h["content-type"] = ct || "application/vnd.apple.mpegurl";
        h["cache-control"] = "no-cache";
        return reply(res, 200, h, m3u8);
      }

      res.writeHead(up.statusCode || 200, h);
      up.pipe(res);
      return;
    }

    // ===== Everything else → megaplay.buzz =====
    const target = "https://megaplay.buzz" + url.pathname + url.search;

    var bodyBuf = null;
    if (req.method === "POST") {
      bodyBuf = await new Promise(function(r) {
        var c = [];
        req.on("data", function(d) { c.push(d); });
        req.on("end", function() { r(Buffer.concat(c)); });
      });
    }

    const up = await proxyFetch(target, req.method, {}, bodyBuf);
    const ct = up.headers["content-type"] || "";
    const h = { ...CORS };
    for (const k of ["content-type", "content-length", "content-range"]) {
      if (up.headers[k]) h[k] = up.headers[k];
    }

    // HTML
    // HTML
    if (ct.includes("text/html")) {
      let html = (await readAll(up)).toString();
      html = rewrite(html);
      if (html.includes("<head>")) {
        html = html.replace("<head>", "<head>" +
          '<meta name="referrer" content="unsafe-url">' +
          "<script>" +
          "Object.defineProperty(document,'referrer',{get:function(){return'https://anikoto.to/';}});" +
          "try{var _f={};Object.defineProperty(window,'top',{get:function(){return _f;}});Object.defineProperty(window,'parent',{get:function(){return _f;}});}catch(e){}" +
          "</script>"
        );
      }
      h["content-type"] = "text/html; charset=UTF-8";
      return reply(res, up.statusCode || 200, h, html);
    }

    // JSON
    if (ct.includes("json")) {
      let json = (await readAll(up)).toString();
      json = rewrite(json);
      return reply(res, up.statusCode || 200, { ...h, "content-type": "application/json; charset=UTF-8" }, json);
    }

    // m3u8
    if (ct.includes("mpegurl") || ct.includes("m3u8")) {
      let m3u8 = (await readAll(up)).toString();
      m3u8 = rewrite(m3u8);
      h["content-type"] = ct || "application/vnd.apple.mpegurl";
      return reply(res, up.statusCode || 200, h, m3u8);
    }

    // JS
    if (ct.includes("javascript")) {
      let js = (await readAll(up)).toString();
      js = rewrite(js);
      return reply(res, up.statusCode || 200, h, js);
    }

    // Static assets
    res.writeHead(up.statusCode || 200, h);
    up.pipe(res);

  } catch (err) {
    reply(res, 502, { ...CORS, "content-type": "application/json" }, { error: err.message });
  }
});

server.listen(PORT, function() {
  console.log("Stream proxy running on port " + PORT);
});
