import { useState, useEffect, useCallback } from "react";

const MODEL = "claude-sonnet-4-6";
const TICKERS = ["NVDA", "MU", "AMSC", "SMH", "QQQM", "MAGS", "QTUM"];

const WMO = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"], 45: ["Foggy", "🌫️"], 48: ["Icy fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 61: ["Light rain", "🌧️"],
  63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"], 71: ["Light snow", "❄️"],
  73: ["Snow", "❄️"], 80: ["Showers", "🌦️"], 81: ["Showers", "🌦️"],
  95: ["Thunderstorm", "⛈️"],
};

function getWMO(code) {
  return WMO[code] || WMO[Math.floor(code / 10) * 10] || ["Unknown", "🌡️"];
}

async function claudeCall(prompt, extras = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
      ...extras,
    }),
  });
  const data = await res.json();
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

function safeJSON(text) {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const m = clean.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

const CARD = {
  background: "#0d0d0d",
  border: "1px solid rgba(80,180,220,0.14)",
  borderRadius: "14px",
  padding: "14px",
  marginBottom: "12px",
};

const CARD_TITLE = {
  fontSize: "10px", fontWeight: "700", letterSpacing: "1.8px",
  color: "#3db8d4", textTransform: "uppercase",
};

const MUTED = { fontSize: "11px", color: "#2a3a48", fontStyle: "italic" };

function RefreshBtn({ onClick, spinning }) {
  return (
    <button onClick={onClick} title="Refresh" style={{
      background: "none", border: "none", color: "#3db8d4",
      cursor: "pointer", fontSize: "17px", lineHeight: 1, padding: 0,
      opacity: spinning ? 0.4 : 0.8,
      display: "inline-block",
      animation: spinning ? "spin 1s linear infinite" : "none",
    }}>↺</button>
  );
}

export default function JarvisDashboard() {
  const [time, setTime] = useState(new Date());
  const [weather, setWeather] = useState(null);
  const [stocks, setStocks] = useState(null);
  const [news, setNews] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [driveNotes, setDriveNotes] = useState(null);
  const [todos, setTodos] = useState([]);
  const [newTodo, setNewTodo] = useState("");
  const [spin, setSpin] = useState({ weather: true, stocks: true, news: true, calendar: true, notes: true });

  const startSpin = (k) => setSpin((p) => ({ ...p, [k]: true }));
  const stopSpin  = (k) => setSpin((p) => ({ ...p, [k]: false }));

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Todos — persistent
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("anish-jarvis-todos");
        if (r) setTodos(JSON.parse(r.value));
      } catch {}
    })();
  }, []);

  const saveTodos = async (list) => {
    setTodos(list);
    try { await window.storage.set("anish-jarvis-todos", JSON.stringify(list)); } catch {}
  };

  // Fetchers
  const fetchWeather = useCallback(async () => {
    startSpin("weather");
    try {
      const r = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=33.1984&longitude=-96.6398" +
        "&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m" +
        "&temperature_unit=fahrenheit&wind_speed_unit=mph"
      );
      const d = await r.json();
      setWeather(d.current ?? null);
    } catch {}
    stopSpin("weather");
  }, []);

  const fetchStocks = useCallback(async () => {
    startSpin("stocks");
    try {
      const text = await claudeCall(
        `Search for the current stock price of each ticker: ${TICKERS.join(", ")}. ` +
        `Return ONLY a raw JSON array, no markdown: ` +
        `[{"ticker":"NVDA","price":900.00,"change":5.50,"pct":0.62}]. Use today's real market data.`,
        { tools: [{ type: "web_search_20250305", name: "web_search" }] }
      );
      const parsed = safeJSON(text);
      if (Array.isArray(parsed)) setStocks(parsed);
    } catch {}
    stopSpin("stocks");
  }, []);

  const fetchNews = useCallback(async () => {
    startSpin("news");
    try {
      const text = await claudeCall(
        "Search for today's top 6 financial market news stories. " +
        "Prioritize: AI/semiconductors, Fed, major earnings, macro. " +
        'Return ONLY a raw JSON array: [{"headline":"...","source":"...","blurb":"one sentence max"}]. No markdown.',
        { tools: [{ type: "web_search_20250305", name: "web_search" }] }
      );
      const parsed = safeJSON(text);
      if (Array.isArray(parsed)) setNews(parsed);
    } catch {}
    stopSpin("news");
  }, []);

  const fetchCalendar = useCallback(async () => {
    startSpin("calendar");
    try {
      const text = await claudeCall(
        "List my upcoming Google Calendar events for today and the next 7 days. " +
        'Return ONLY a raw JSON array: [{"title":"...","date":"Mon May 9","time":"3:00 PM"}]. Max 8 events. No markdown.',
        { mcp_servers: [{ type: "url", url: "https://calendarmcp.googleapis.com/mcp/v1", name: "gcal" }] }
      );
      const parsed = safeJSON(text);
      setCalendar(Array.isArray(parsed) ? parsed : []);
    } catch { setCalendar([]); }
    stopSpin("calendar");
  }, []);

  const fetchNotes = useCallback(async () => {
    startSpin("notes");
    try {
      const text = await claudeCall(
        'Search my Google Drive for files named "notes", "todo", "tasks", "soft", "keep in mind", "reminders". ' +
        "Read the most recently modified ones and extract key bullet points. " +
        'Return ONLY a raw JSON array: [{"title":"filename","bullets":["point 1","point 2"]}]. Max 4 files, 5 bullets each. No markdown.',
        { mcp_servers: [{ type: "url", url: "https://drivemcp.googleapis.com/mcp/v1", name: "gdrive" }] }
      );
      const parsed = safeJSON(text);
      setDriveNotes(Array.isArray(parsed) ? parsed : []);
    } catch { setDriveNotes([]); }
    stopSpin("notes");
  }, []);

  useEffect(() => {
    fetchWeather();
    fetchStocks();
    fetchNews();
    fetchCalendar();
    fetchNotes();
  }, []);

  // Todo handlers
  const addTodo = () => {
    const t = newTodo.trim();
    if (!t) return;
    saveTodos([...todos, { id: Date.now(), text: t, done: false }]);
    setNewTodo("");
  };
  const toggleTodo = (id) => saveTodos(todos.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  const removeTodo = (id) => saveTodos(todos.filter((t) => t.id !== id));

  // Helpers
  const fmtTime = (d) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtDate = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const greeting = () => {
    const h = time.getHours();
    if (h < 12) return "Good morning, Anish ☀️";
    if (h < 17) return "Good afternoon, Anish";
    return "Good evening, Anish 🌙";
  };
  const wInfo = weather?.weathercode !== undefined ? getWMO(weather.weathercode) : null;

  return (
    <div style={{ background: "#000", minHeight: "100vh", color: "#cce0f5", fontFamily: "'Inter', -apple-system, sans-serif", padding: "16px" }}>
      <style>{`@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } } *{box-sizing:border-box;}`}</style>

      {/* ── HEADER ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "#0d0d0d", border: "1px solid rgba(0,150,210,0.2)",
        borderRadius: "14px", padding: "14px 22px", marginBottom: "14px",
      }}>
        <div>
          <div style={{ fontFamily: "monospace", fontSize: "32px", fontWeight: "700", color: "#00d4ff", letterSpacing: "3px" }}>
            {fmtTime(time)}
          </div>
          <div style={{ fontSize: "12px", color: "#1e3040", marginTop: "3px" }}>{fmtDate(time)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "16px", fontWeight: "600", color: "#a8c8ec" }}>{greeting()}</div>
          <div style={{ fontSize: "12px", color: "#1e3040", marginTop: "4px" }}>McKinney TX · UTD · Finance</div>
        </div>
      </div>

      {/* ── TOP 3-COL GRID ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.7fr 1fr", gap: "12px", alignItems: "start", marginBottom: "12px" }}>

        {/* COL 1 — Weather + To-Do */}
        <div>
          <div style={CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={CARD_TITLE}>🌡️&nbsp; Weather — McKinney TX</span>
              <RefreshBtn onClick={fetchWeather} spinning={spin.weather} />
            </div>
            {weather ? (
              <>
                <div style={{ fontSize: "42px", fontWeight: "800", color: "#00d4ff", fontFamily: "monospace", lineHeight: 1 }}>
                  {Math.round(weather.temperature_2m)}°F
                </div>
                {wInfo && <div style={{ fontSize: "15px", marginTop: "6px", color: "#80aac8" }}>{wInfo[1]} {wInfo[0]}</div>}
                <div style={{ fontSize: "12px", color: "#1e3040", marginTop: "8px" }}>
                  Feels {Math.round(weather.apparent_temperature)}°F · Wind {Math.round(weather.windspeed_10m)} mph
                </div>
              </>
            ) : <div style={MUTED}>{spin.weather ? "Fetching weather..." : "Unavailable"}</div>}
          </div>

          <div style={CARD}>
            <div style={{ ...CARD_TITLE, marginBottom: "10px" }}>📋&nbsp; To-Do</div>
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
              <input
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTodo()}
                placeholder="Add task... (Enter)"
                style={{
                  flex: 1, background: "#1a1a1a", border: "1px solid rgba(0,160,220,0.2)",
                  borderRadius: "8px", padding: "6px 10px", color: "#cce0f5", fontSize: "12px", outline: "none",
                }}
              />
              <button onClick={addTodo} style={{
                background: "rgba(0,150,210,0.15)", border: "1px solid rgba(0,150,210,0.35)",
                borderRadius: "8px", color: "#00d4ff", padding: "6px 11px", cursor: "pointer", fontSize: "16px", lineHeight: 1,
              }}>+</button>
            </div>
            {todos.length === 0 && <div style={MUTED}>No tasks yet</div>}
            {todos.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "6px 0", borderBottom: "1px solid #111" }}>
                <input type="checkbox" checked={t.done} onChange={() => toggleTodo(t.id)}
                  style={{ cursor: "pointer", accentColor: "#00d4ff", marginTop: "2px", flexShrink: 0 }} />
                <span style={{
                  flex: 1, fontSize: "12px", lineHeight: "1.5",
                  color: t.done ? "#1a2530" : "#a8c8ec",
                  textDecoration: t.done ? "line-through" : "none",
                }}>{t.text}</span>
                <button onClick={() => removeTodo(t.id)}
                  style={{ background: "none", border: "none", color: "#2a1a1a", cursor: "pointer", fontSize: "16px", padding: 0, lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        </div>

        {/* COL 2 — Portfolio */}
        <div style={CARD}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={CARD_TITLE}>📈&nbsp; Portfolio</span>
            <RefreshBtn onClick={fetchStocks} spinning={spin.stocks} />
          </div>
          {Array.isArray(stocks) ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(0,160,220,0.15)" }}>
                  {["Ticker", "Price", "Change", "%"].map((h) => (
                    <th key={h} style={{
                      textAlign: "left", fontSize: "9px", color: "#1e3548",
                      fontWeight: "700", padding: "3px 8px", letterSpacing: "1px", textTransform: "uppercase",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => {
                  const pos = Number(s.change) >= 0;
                  const col = pos ? "#00e676" : "#ff5252";
                  return (
                    <tr key={s.ticker} style={{ borderBottom: "1px solid #111" }}>
                      <td style={{ padding: "7px 8px", fontFamily: "monospace", fontWeight: "700", fontSize: "13px", color: "#d8eeff" }}>{s.ticker}</td>
                      <td style={{ padding: "7px 8px", fontFamily: "monospace", fontSize: "13px", color: "#cce0f5" }}>${Number(s.price).toFixed(2)}</td>
                      <td style={{ padding: "7px 8px", fontFamily: "monospace", fontSize: "12px", color: col }}>
                        {pos ? "▲ +" : "▼ "}{Number(s.change).toFixed(2)}
                      </td>
                      <td style={{ padding: "7px 8px", fontFamily: "monospace", fontSize: "12px", color: col }}>
                        {pos ? "+" : ""}{Number(s.pct).toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <div style={MUTED}>{spin.stocks ? "Fetching live prices..." : "No data"}</div>}
        </div>

        {/* COL 3 — Calendar + Drive Notes */}
        <div>
          <div style={CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={CARD_TITLE}>📅&nbsp; Calendar</span>
              <RefreshBtn onClick={fetchCalendar} spinning={spin.calendar} />
            </div>
            {Array.isArray(calendar) ? (
              calendar.length > 0 ? calendar.map((e, i) => (
                <div key={i} style={{ padding: "7px 0", borderBottom: "1px solid #111" }}>
                  <div style={{ fontSize: "12px", fontWeight: "600", color: "#b0caec", lineHeight: "1.4" }}>{e.title}</div>
                  <div style={{ fontSize: "10px", color: "#00a8cc", marginTop: "3px" }}>
                    {e.date}{e.time ? ` · ${e.time}` : ""}
                  </div>
                </div>
              )) : <div style={MUTED}>No upcoming events</div>
            ) : <div style={MUTED}>{spin.calendar ? "Loading..." : "Could not load"}</div>}
          </div>

          <div style={CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={CARD_TITLE}>📝&nbsp; Drive Notes</span>
              <RefreshBtn onClick={fetchNotes} spinning={spin.notes} />
            </div>
            {Array.isArray(driveNotes) ? (
              driveNotes.length > 0 ? driveNotes.map((n, i) => (
                <div key={i} style={{ marginBottom: "14px" }}>
                  <div style={{ fontSize: "10px", fontWeight: "700", color: "#00a8cc", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "5px" }}>
                    {n.title}
                  </div>
                  {Array.isArray(n.bullets) && n.bullets.map((b, j) => (
                    <div key={j} style={{
                      fontSize: "11px", color: "#3a5870", padding: "3px 0 3px 10px",
                      borderLeft: "2px solid rgba(0,150,210,0.2)", marginBottom: "4px", lineHeight: "1.45",
                    }}>{b}</div>
                  ))}
                </div>
              )) : <div style={MUTED}>No notes found in Drive</div>
            ) : <div style={MUTED}>{spin.notes ? "Scanning Drive..." : "Could not load"}</div>}
          </div>
        </div>
      </div>

      {/* ── BOTTOM : News 2-column grid ── */}
      <div style={{ background: "#0d0d0d", border: "1px solid rgba(80,180,220,0.14)", borderRadius: "14px", padding: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <span style={CARD_TITLE}>📰&nbsp; Market News</span>
          <RefreshBtn onClick={fetchNews} spinning={spin.news} />
        </div>
        {Array.isArray(news) ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {news.map((n, i) => (
              <div key={i} style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: "10px", padding: "11px 13px" }}>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#b8d4f0", lineHeight: "1.45", marginBottom: "5px" }}>
                  {n.headline}
                </div>
                <div style={{ fontSize: "10px", color: "#1e3548", fontWeight: "700", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "5px" }}>
                  {n.source}
                </div>
                {n.blurb && (
                  <div style={{ fontSize: "11px", color: "#3a5870", lineHeight: "1.45" }}>{n.blurb}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={MUTED}>{spin.news ? "Searching headlines..." : "No data"}</div>
        )}
      </div>
    </div>
  );
}
