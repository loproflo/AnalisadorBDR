// functions/api/quotes.js (Cloudflare Pages Function)
const ALLOWED_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=60"
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function getUsdBrl() {
  try {
    const res = await fetchWithTimeout("https://economia.awesomeapi.com.br/json/last/USD-BRL");
    if (res.ok) {
      const data = await res.json();
      const bid = parseFloat(data?.USDBRL?.bid);
      if (Number.isFinite(bid) && bid > 3 && bid < 10) return Number(bid.toFixed(4));
    }
  } catch (_) {}
  return null;
}

async function fetchYahooQuote(tickerSa) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tickerSa)}?interval=1d&range=5d`;
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }
  }, 4500);
  if (!res.ok) return null;
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return null;

  const price = Number(meta.regularMarketPrice);
  const prevClose = Number(meta.chartPreviousClose || meta.previousClose || price);
  const dayLow = Number(meta.regularMarketDayLow || price);
  const dayHigh = Number(meta.regularMarketDayHigh || price);
  const fiftyTwoWeekLow = Number(meta.fiftyTwoWeekLow || dayLow);
  const fiftyTwoWeekHigh = Number(meta.fiftyTwoWeekHigh || dayHigh);

  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    priceBrl: Number(price.toFixed(2)),
    prevClose: Number(prevClose.toFixed(2)),
    dayLow: Number(dayLow.toFixed(2)),
    dayHigh: Number(dayHigh.toFixed(2)),
    min52w: Number(fiftyTwoWeekLow.toFixed(2)),
    max52w: Number(fiftyTwoWeekHigh.toFixed(2)),
    marketTime: meta.regularMarketTime || null
  };
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: ALLOWED_HEADERS });
  }

  try {
    const url = new URL(request.url);
    const rawTickers = (url.searchParams.get("tickers") || "")
      .split(",")
      .map(t => t.trim().toUpperCase().replace(/[^A-Z0-9.]/g, ""))
      .filter(Boolean)
      .slice(0, 35);

    const fxPromise = getUsdBrl();
    const quotesMap = {};

    const batchSize = 8;
    for (let i = 0; i < rawTickers.length; i += batchSize) {
      const batch = rawTickers.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (tk) => {
          const saSymbol = tk.endsWith(".SA") ? tk : `${tk}.SA`;
          const data = await fetchYahooQuote(saSymbol);
          return [tk.replace(/\.SA$/, ""), data];
        })
      );
      for (const [tk, data] of results) {
        if (data) quotesMap[tk] = data;
      }
    }

    const usdBrl = await fxPromise;

    return new Response(
      JSON.stringify({
        ok: true,
        updatedAt: new Date().toISOString(),
        usdBrl,
        quotes: quotesMap
      }),
      { status: 200, headers: ALLOWED_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "upstream_unavailable",
        usdBrl: null,
        quotes: {}
      }),
      { status: 200, headers: ALLOWED_HEADERS }
    );
  }
}
