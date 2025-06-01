const QQMusicAPI = require('./qqmusic-api.js');

// common CORS headers
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 1) Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 2) All other requests need CORS headers on the response
    const respHeaders = { ...CORS_HEADERS, "Content-Type": "application/json" };

    // 3) Non‐API: passthrough
    if (!url.pathname.startsWith("/api/")) {
      return fetch(request);
    }

    try {
      // GET /api/getQrcode?type=qq|wx  &  /api/checkQrcode?type=&id=
      if (request.method === "GET") {
        if (url.pathname === "/api/getQrcode") {
          const type = url.searchParams.get('type') === 'wx'
            ? QQMusicAPI.QRLoginType.WX
            : QQMusicAPI.QRLoginType.QQ;

          const qr = await QQMusicAPI.getQrcode(type);
          // qr.data is an ArrayBuffer or Buffer
          const b64 = typeof Buffer !== 'undefined'
            ? Buffer.from(qr.data).toString('base64')
            : btoa(String.fromCharCode(...new Uint8Array(qr.data)));

          return new Response(JSON.stringify({
            image: b64,
            identifier: qr.identifier
          }), { headers: respHeaders });
        }
        if (url.pathname === "/api/checkQrcode") {
          const rawType = url.searchParams.get('type');
          const type = rawType === 'wx'
            ? QQMusicAPI.QRLoginType.WX
            : QQMusicAPI.QRLoginType.QQ;
          const id = url.searchParams.get('id');

          // checkQrcode expects an object { qrType, identifier, … }
          const result = await QQMusicAPI.checkQrcode({ qrType: type, identifier: id });
          // result is [ eventName, credentialObject ]
          return new Response(JSON.stringify({
            event: result[0],
            credential: result[1]
          }), { headers: respHeaders });
        }
        return new Response("Not found", { status: 404, headers: respHeaders });
      }

      // 4) POST /api/<method>
      if (request.method === "POST") {
        const apiName = url.pathname.replace(/^\/api\//, "");
        const fn = QQMusicAPI[apiName];
        if (typeof fn !== "function") {
          return new Response(
            JSON.stringify({ error: `No such API: ${apiName}` }),
            { status: 404, headers: respHeaders }
          );
        }

        const { params = {}, credential } = await request.json();
        const raw = await fn(...Object.values(params), credential);
        // if this is an Axios response, unwrap `.data`, otherwise leave as-is
        const result = raw && raw.data !== undefined ? raw.data : raw;

        return new Response(
          JSON.stringify({ response: result }),
          { headers: respHeaders }
        );
      }

      // unsupported method
      return new Response("Method not allowed", {
        status: 405,
        headers: respHeaders
      });

    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message }),
        { status: 500, headers: respHeaders }
      );
    }
  }
};