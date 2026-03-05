const express = require('express');
const app = express();

// Store events in memory
const events = [];
const MAX_EVENTS = 500;

app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Helper functions
function parseANPREvent(body) {
  const plateMatch = body.match(/<plateNumber>(.*?)<\/plateNumber>/) ||
                     body.match(/<licensePlate>(.*?)<\/licensePlate>/);
  const timeMatch = body.match(/<dateTime>(.*?)<\/dateTime>/);
  const confMatch = body.match(/<confidence>(.*?)<\/confidence>/);
  const dirMatch = body.match(/<direction>(.*?)<\/direction>/);
  const deviceMatch = body.match(/<deviceID>(.*?)<\/deviceID>/);
  const ipMatch = body.match(/<ipAddress>(.*?)<\/ipAddress>/);
  
  return {
    plate: plateMatch ? plateMatch[1] : 'UNKNOWN',
    dateTime: timeMatch ? timeMatch[1] : new Date().toISOString(),
    confidence: confMatch ? confMatch[1] : 'N/A',
    direction: dirMatch ? dirMatch[1] : 'N/A',
    deviceID: deviceMatch ? deviceMatch[1] : 'N/A',
    cameraIP: ipMatch ? ipMatch[1] : 'N/A'
  };
}

// Root - Dashboard
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SEANOV8 ANPR Monitor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #1e3a8a, #3b82f6); padding: 30px; border-radius: 16px; margin-bottom: 20px; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .stat { background: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155; }
    .stat .value { font-size: 32px; font-weight: 700; color: #60a5fa; margin-bottom: 5px; }
    .stat .label { color: #94a3b8; font-size: 13px; }
    .events { background: #1e293b; border-radius: 12px; border: 1px solid #334155; }
    .events-header { padding: 20px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
    .events-header h2 { font-size: 18px; }
    .refresh { background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; }
    .refresh:hover { background: #2563eb; }
    .event { padding: 15px 20px; border-bottom: 1px solid #334155; display: grid; grid-template-columns: 150px 180px 100px 120px 1fr; gap: 15px; align-items: center; }
    .event:last-child { border-bottom: none; }
    .plate { font-size: 18px; font-weight: 700; font-family: monospace; color: #fbbf24; }
    .time { color: #94a3b8; font-size: 13px; }
    .confidence { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .conf-high { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
    .conf-med { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
    .conf-low { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
    .direction { color: #60a5fa; }
    .camera { color: #94a3b8; font-size: 13px; font-family: monospace; }
    .empty { padding: 60px 20px; text-align: center; color: #64748b; }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚗 SEANOV8 ANPR Monitor</h1>
      <p>Real-time license plate detection - Endpoint: <strong>/anpr</strong></p>
    </div>
    
    <div class="stats">
      <div class="stat">
        <div class="value" id="totalEvents">-</div>
        <div class="label">Total Events</div>
      </div>
      <div class="stat">
        <div class="value pulse" id="lastHour">-</div>
        <div class="label">Last Hour</div>
      </div>
      <div class="stat">
        <div class="value" id="todayEvents">-</div>
        <div class="label">Today</div>
      </div>
      <div class="stat">
        <div class="value" id="cameras">-</div>
        <div class="label">Active Cameras</div>
      </div>
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
    function getConfClass(conf) {
      const c = parseInt(conf);
      if (c >= 90) return 'conf-high';
      if (c >= 70) return 'conf-med';
      return 'conf-low';
    }

    async function loadStats() {
      const res = await fetch('/api/stats');
      const data = await res.json();
      document.getElementById('totalEvents').textContent = data.total;
      document.getElementById('lastHour').textContent = data.lastHour;
      document.getElementById('todayEvents').textContent = data.today;
      document.getElementById('cameras').textContent = data.cameras;
    }

    async function loadEvents() {
      const res = await fetch('/api/events');
      const data = await res.json();
      const list = document.getElementById('eventsList');
      
      if (data.events.length === 0) {
        list.innerHTML = '<div class="empty">No events detected yet. Configure camera to POST to /anpr</div>';
        return;
      }
      
      list.innerHTML = data.events.map(e => \`
        <div class="event">
          <div class="plate">\${e.plate}</div>
          <div class="time">\${new Date(e.dateTime).toLocaleString()}</div>
          <div class="confidence \${getConfClass(e.confidence)}">\${e.confidence}%</div>
          <div class="direction">\${e.direction}</div>
          <div class="camera">\${e.cameraIP}</div>
        </div>
      \`).join('');
    }

    async function loadAll() {
      await loadStats();
      await loadEvents();
    }

    setInterval(loadAll, 5000);
    loadAll();
  </script>
</body>
</html>`);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), events: events.length });
});

// ✅ CRITICAL: Support GET/HEAD for camera testing
app.get('/anpr', (req, res) => {
  res.status(200).type('text/plain').send('ANPR ENDPOINT READY');
});

app.head('/anpr', (req, res) => {
  res.status(200).end();
});

// ✅ POST endpoint for camera events
app.post('/anpr', (req, res) => {
  const body = req.body.toString();
  
  if (body.includes('<eventType>ANPR</eventType>') || body.includes('plateNumber') || body.includes('licensePlate')) {
    const event = parseANPREvent(body);
    event.id = Date.now();
    event.receivedAt = new Date().toISOString();
    
    events.unshift(event);
    if (events.length > MAX_EVENTS) events.pop();
    
    console.log('\n╔═══════════════════════════════════╗');
    console.log('║     ANPR EVENT RECEIVED          ║');
    console.log('╠═══════════════════════════════════╣');
    console.log('║ Plate:      ' + event.plate.padEnd(20) + '║');
    console.log('║ Time:       ' + event.dateTime.substring(0,19).padEnd(20) + '║');
    console.log('║ Confidence: ' + (event.confidence+'%').padEnd(20) + '║');
    console.log('║ Direction:  ' + event.direction.padEnd(20) + '║');
    console.log('║ Camera:     ' + event.cameraIP.padEnd(20) + '║');
    console.log('╚═══════════════════════════════════╝\n');
  }
  
  // CRITICAL: Send ACK
  res.status(200).set({
    'Content-Length': '0',
    'Connection': 'keep-alive'
  }).end();
});

// API: Get events
app.get('/api/events', (req, res) => {
  res.json({
    total: events.length,
    events: events.slice(0, 100)
  });
});

// API: Get stats
app.get('/api/stats', (req, res) => {
  const now = new Date();
  const oneHourAgo = new Date(now - 60*60*1000);
  const todayStart = new Date(now.setHours(0,0,0,0));
  
  const lastHour = events.filter(e => new Date(e.receivedAt) > oneHourAgo).length;
  const today = events.filter(e => new Date(e.receivedAt) > todayStart).length;
  
  res.json({
    total: events.length,
    lastHour: lastHour,
    today: today,
    cameras: [...new Set(events.map(e => e.cameraIP))].length
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n┌────────────────────────────────────────┐');
  console.log('│  SEANOV8 ANPR Server - FIXED VERSION  │');
  console.log('└────────────────────────────────────────┘');
  console.log('\n🌍 Server: http://0.0.0.0:' + PORT);
  console.log('📊 Dashboard: /');
  console.log('📡 ANPR Endpoint: /anpr (GET test + POST events)');
  console.log('\n✅ Camera can test with GET /anpr');
  console.log('✅ Camera sends events to POST /anpr\n');
});
