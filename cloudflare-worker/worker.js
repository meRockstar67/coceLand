// coceLand mod proxy
// Отдельный, независимый Cloudflare Worker. Не связан с renah0cki.
//
// Что делает: принимает запрос вида
//   https://ТВОЙ-ВОРКЕР.workers.dev/mod?url=<encoded modrinth cdn url>
// сам скачивает файл с Modrinth (со стороны Cloudflare, где нет блокировки)
// и отдаёт его обратно как обычный файл.
//
// Из соображений безопасности принимает ссылки ТОЛЬКО с доменов Modrinth -
// нельзя превратить воркер в открытый прокси на произвольные сайты.

const ALLOWED_HOSTS = ["cdn.modrinth.com", "api.modrinth.com"];

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname !== "/mod") {
      return new Response("Not found", { status: 404 });
    }

    const target = requestUrl.searchParams.get("url");
    if (!target) {
      return new Response("Missing ?url= parameter", { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response("Invalid url", { status: 400 });
    }

    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return new Response(
        `Host not allowed: ${targetUrl.hostname}. Only Modrinth is proxied here.`,
        { status: 403 }
      );
    }

    const upstream = await fetch(targetUrl.toString(), {
      headers: { "User-Agent": "coceLand-launcher-proxy/1.0" },
    });

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, {
        status: upstream.status,
      });
    }

    // Просто прокидываем файл как есть, с CORS на всякий случай.
    const headers = new Headers(upstream.headers);
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  },
};
