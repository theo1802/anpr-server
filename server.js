

const express = require("express");
const app = express();

// In-memory storage (demo)
const events = [];
const MAX_EVENTS = 500;

// Accept any content-type as raw (Hikvision often sends XML or multipart)
app.use(express.raw({ type: "*/*", limit: "20mb" }));

// --- Helpers ---
function safeString(v) {
  return (v ?? "").toString();
}

function pickFirstMatch(body, regex) {
  const m = body.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

function parseAnprEvent(body, req) {
  // Try to detect ANPR/LPR event types (payloads vary by model/firmware)
  const bodyLower = body.toLowerCase();
  const looksLikeAnpr =
    body.includes("<eventType>ANPR</eventType>") ||
    body.includes("<eventType>LPR</eventType>") ||
    bodyLower.includes("anpr") ||
    bodyLower.includes("licenseplate") ||
    bodyLower.includes("platenumber") ||
    bodyLower.includes("licenseplate");

  // Extract common fields (best effort)
  const plate =
    pickFirstMatch(body, /<plateNumber>(.*?)<\/plateNumber>/i) ||
    pickFirstMatch(body, /<licensePlate>(.*?)<\/licensePlate>/i) ||
    pickFirstMatch(body, /<plate>(.*?)<\/plate>/i) ||
    "UNKNOWN";

  const dateTime =
    pickFirstMatch(body, /<dateTime>(.*?)<\/dateTime>/i) ||
    pickFirstMatch(body, /<time>(.*?)<\/time>/i) ||
    new Date().toISOString();

  const confidence =
    pickFirstMatch(body, /<confidence>(.*?)<\/confidence>/i) ||
    pickFirstMatch(body, /<score>(.*?)<\/score>/i) ||
    "N/A";

  const direction =
    pickFirstMatch(body, /<direction>(.*?)<\/direction>/i) ||
    pickFirstMatch(body, /<vehicleDirection>(.*?)<\/vehicleDirection>/i) ||
    "N/A";

  const deviceID =
    pickFirstMatch(body, /<deviceID>(.*?)<\/deviceID>/i) ||
    pickFirstMatch(body, /<deviceId>(.*?)<\/deviceId>/i) ||
    "N/A";

  const ipFromPayload =
    pickFirstMatch(body, /<ipAddress>(.*?)<\/ipAddress>/i) ||
    pickFirstMatch(body, /<ipv4Address>(.*?)<\/ipv4Address>/i);

  const cameraIP = ipFromPayload || req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.ip;

  return {
    looksLikeAnpr,
    event: {
      id: Date.now(),
      plate,
      dateTime,
      confidence,
      direction,
      deviceID,
      cameraIP,
      receivedAt: new Date().toISOString(),
    },
  };
}

// --- Routes ---

// Root dashboard (HTML UI)
app.get("/", (req, res) => {
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>SEANOV8 ANPR Monitor</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0}
    .container{max-width:1400px;margin:0 auto;padding:20px}
    .header{background:linear-gradient(135deg,#1e3a8a,#3b82f6);padding:28px;border-radius:16px;margin-bottom:18px}
    .header h1{font-size:26px;margin-bottom:6px}
    .header p{opacity:.9;font-size:14px}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:18px}
    .stat{background:#1e293b;padding:18px;border-radius:12px;border:1px solid #334155}
    .value{font-size:32px;font-weight:800;color:#60a5fa;margin-bottom:6px}
    .label{color:#94a3b8;font-size:13px}
    .events{background:#1e293b;border-radius:12px;border:1px solid #334155}
    .events-header{padding:18px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center}
    .events-header h2{font-size:18px}
    .refresh{background:#3b82f6;color:#fff;border:none;padding:8px 16px;border-radius:10px;cursor:pointer;font-weight:700}
    .refresh:hover{background:#2563eb}
    .event{padding:14px 18px;border-bottom:1px solid #334155;display:grid;grid-template-columns:150px 230px 120px 120px 1fr;gap:12px;align-items:center}
    .event:last-child{border-bottom:none}
    .plate{font-size:18px;font-weight:800;font-family:ui-monospace,Menlo,monospace;color:#fbbf24}
    .time{color:#94a3b8;font-size:13px}
    .confidence{display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:800}
    .conf-high{background:rgba(34,197,94,.2);color:#22c55e}
    .conf-med{background:rgba(251,191,36,.2);color:#fbbf24}
    .conf-low{background:rgba(239,68,68,.2);color:#ef4444}
    .direction{color:#60a5fa}
    .camera{color:#94a3b8;font-size:13px;font-family:ui-monospace,Menlo,monospace}
    .empty{padding:56px 18px;text-align:center;color:#64748b}
    .pulse{animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚗 SEANOV8 ANPR Monitor</h1>
      <p>Real-time license plate detection (Hikvision). Endpoint: <b>/anpr</b></p>
    </div>

    <div class="stats">
      <div class="stat"><div class="value" id="totalEvents">-</div><div class="label">Total Events</div></div>
      <div class="stat"><div class="value pulse" id="lastHour">-</div><div class="label">Last Hour</div></div>
      <div class="stat"><div class="value" id="todayEvents">-</div><div class="label">Today</div></div>
      <div class="stat"><div class="value" id="cameras">-</div><div class="label">Active Cameras</div></div>
    </div>

    <div class="events">
      <div class="events-header">
        <h2>Recent Detections</h2>
        <button class="refresh" onclick="loadAll()">Refresh</button>
      </div>
      <div id="eventsList"></div>
    </div>
  </div>

  <script>
    function confClass(conf){
      const c=parseInt(conf,10);
      if(!Number.isFinite(c)) return 'conf-med';
      if(c>=90) return 'conf-high';
      if(c>=70) return 'conf-med';
      return 'conf-low';
    }

    async function loadStats(){
      const res=await fetch('/api/stats');
      const data=await res.json();
      document.getElementById('totalEvents').textContent=data.total;
      document.getElementById('lastHour').textContent=data.lastHour;
      document.getElementById('todayEvents').textContent=data.today;
      document.getElementById('cameras').textContent=data.cameras;
    }

    async function loadEvents(){
      const res=await fetch('/api/events');
      const data=await res.json();
      const list=document.getElementById('eventsList');

      if(!data.events || data.events.length===0){
        list.innerHTML='<div class="empty">No events yet. Configure camera to POST to <b>/anpr</b>.</div>';
        return;
      }

      list.innerHTML=data.events.map(e=>\`
        <div class="event">
          <div class="plate">\${e.plate}</div>
          <div class="time">\${new Date(e.dateTime).toLocaleString()}</div>
          <div class="confidence \${confClass(e.confidence)}">\${e.confidence}%</div>
          <div class="direction">\${e.direction}</div>
          <div class="camera">\${e.cameraIP}</div>
        </div>\`
      ).join('');
    }

    async function loadAll(){
      await loadStats();
      await loadEvents();
    }

    setInterval(loadAll, 5000);
    loadAll();
  </script>
</body>
</html>`);
});

// Health
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), events: events.length });
});

/**
 * ✅ Camera/BROWSER test routes
 * Fixes "Cannot GET /anpr" and Hikvision "service unavailable" on Test
 */
app.get("/anpr", (req, res) => {
  res.status(200).type("text/plain").send("ANPR ENDPOINT READY");
});

app.head("/anpr", (req, res) => {
  res.status(200).end();
});

/**
 * ✅ Receive Hikvision events (POST)
 */
app.post("/anpr", (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : safeString(req.body);

  const { looksLikeAnpr, event } = parseAnprEvent(body, req);

  if (looksLikeAnpr) {
    events.unshift(event);
    if (events.length > MAX_EVENTS) events.pop();

    console.log("\n╔═══════════════════════════════════╗");
    console.log("║     ANPR EVENT RECEIVED          ║");
    console.log("╠═══════════════════════════════════╣");
    console.log("║ Plate:      " + safeString(event.plate).padEnd(20) + "║");
    console.log("║ Time:       " + safeString(event.dateTime).substring(0, 19).padEnd(20) + "║");
    console.log("║ Confidence: " + (safeString(event.confidence) + "%").padEnd(20) + "║");
    console.log("║ Direction:  " + safeString(event.direction).padEnd(20) + "║");
    console.log("║ Camera:     " + safeString(event.cameraIP).padEnd(20) + "║");
    console.log("╚═══════════════════════════════════╝\n");
  } else {
    console.log("[/anpr] Payload received (not detected as ANPR/LPR). length=", body.length);
  }

  // ✅ CRITICAL ACK for Hikvision
  res.status(200).type("text/plain").send("OK");
});

// API: events
app.get("/api/events", (req, res) => {
  res.json({ total: events.length, events: events.slice(0, 100) });
});

// API: stats
app.get("/api/stats", (req, res) => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const lastHour = events.filter((e) => new Date(e.receivedAt) > oneHourAgo).length;
  const today = events.filter((e) => new Date(e.receivedAt) > todayStart).length;

  res.json({
    total: events.length,
    lastHour,
    today,
    cameras: [...new Set(events.map((e) => e.cameraIP))].length,
  });
});

// --- Start ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log("\n┌────────────────────────────────────────┐");
  console.log("│  SEANOV8 ANPR Cloud Server Running     │");
  console.log("└────────────────────────────────────────┘");
  console.log(`\n🌍 Listening on 0.0.0.0:${PORT}`);
  console.log("📊 Dashboard: /");
  console.log("📡 ANPR Endpoint: /anpr (GET/HEAD test + POST event)");
  console.log("\n⚙️  Configure cameras to POST to: /anpr\n");
});
