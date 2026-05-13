import { useState, useEffect, useCallback, useRef } from "react";

const MODEL = "claude-sonnet-4-6";

const GROUPS = [
  { label: "Core",     tickers: ["NVDA","MU","AMSC"] },
  { label: "ETFs",     tickers: ["SMH","QQQM","QQQ","MAGS"] },
  { label: "Thematic", tickers: ["QTUM","NUKZ","SPGP"] },
];

const EXAMS = [
  { name: "OPRE 3333 Exam 3",   date: "2026-05-12", color: "#f59e0b" },
  { name: "FIN 4300 Midterm 3", date: "2026-05-14", color: "#ef4444" },
];

const WMO = {
  0:["Clear","☀️"],1:["Mainly Clear","🌤️"],2:["Partly Cloudy","⛅"],3:["Overcast","☁️"],
  45:["Foggy","🌫️"],51:["Drizzle","🌦️"],61:["Light Rain","🌧️"],63:["Rain","🌧️"],
  80:["Showers","🌦️"],95:["Thunderstorm","⛈️"],
};
const getWMO = c => WMO[c] || WMO[Math.floor(c/10)*10] || ["Unknown","🌡️"];

// ── Claude API helpers ──────────────────────────────────────────
async function apiCall(prompt, extras = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
      ...extras,
    }),
  });
  const d = await res.json();
  return (d.content ?? []).filter(b => b.type === "text").map(b => b.text).join("");
}

async function jarvisCall(messages, system, extras = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 900,
      system,
      messages,
      ...extras,
    }),
  });
  const d = await res.json();
  return (d.content ?? []).filter(b => b.type === "text").map(b => b.text).join("");
}

function parseJSON(txt) {
  try {
    const clean = txt.replace(/```json|```/g,"").trim();
    const m = clean.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

function daysUntil(d) {
  const t = new Date(); t.setHours(0,0,0,0);
  const x = new Date(d); x.setHours(0,0,0,0);
  return Math.round((x-t)/86400000);
}

// ── Jarvis persona ──────────────────────────────────────────────
const JARVIS_BASE = `You are Jarvis — the personal AI assistant of Anish Kumar Boddu. You are loyal, sharp, dry-witted, and genuinely invested in his success. You have a warm British sensibility: polite but never sycophantic, witty but never frivolous.

WHO ANISH IS:
- 20 years old, sophomore at UT Dallas (Jindal School of Management)
- Finance BS with Investment Concentration — graduating May 2028
- Runs Bubba's Fireworks as seasonal independent contractor (summer + New Year)
- Works at micro1 as an AI Evaluation Specialist ($22-70/hr, remote)
- Active investor with heavy AI/semiconductor focus: NVDA, MU, AMSC, SMH, QQQM, QQQ, MAGS, QTUM, NUKZ, SPGP
- Currently on a fitness cut — targeting visible abs, training 5x/week, volleyball
- Birthday: August 1st
- Based in McKinney, TX

STYLE: Use "sir" naturally 2-3 times per response. Never every sentence — that's parody. Keep responses concise and conversational unless detail is requested. End with dry wit when appropriate.`;

function buildSystem(ctx) {
  const lines = [JARVIS_BASE, "\n\nLIVE CONTEXT:"];
  if (ctx.weather) {
    const wi = getWMO(ctx.weather.weather_code);
    lines.push(`Weather: ${Math.round(ctx.weather.temperature_2m)}°F, ${wi[0]}, feels ${Math.round(ctx.weather.apparent_temperature)}°F`);
  }
  if (ctx.stocks?.length) lines.push(`Portfolio: ${ctx.stocks.map(s=>`${s.ticker} ${Number(s.pct)>=0?"+":""}${Number(s.pct).toFixed(2)}%`).join(", ")}`);
  if (ctx.calendar?.length) lines.push(`Calendar: ${ctx.calendar.map(e=>`${e.title} (${e.date})`).join("; ")}`);
  if (ctx.news?.length) lines.push(`Market news: ${ctx.news.map(n=>n.headline).join(" | ")}`);
  if (ctx.userNotes) lines.push(`Anish's current thoughts: ${ctx.userNotes}`);
  if (ctx.driveNotes?.length) lines.push(`From Drive: ${ctx.driveNotes.map(n=>`${n.title}: ${(n.bullets||[]).join(", ")}`).join("; ")}`);
  return lines.join("\n");
}

// ── Small reusable components ───────────────────────────────────
const CARD = { background:"#0d0d0d", border:"1px solid #1a2e3a", borderRadius:12, padding:12 };
const LABEL = { fontSize:9, fontWeight:700, letterSpacing:"1.5px", color:"#3db8d4", textTransform:"uppercase" };
const DIM = { fontSize:11, color:"#253545", fontStyle:"italic" };

function RefBtn({ onClick, spinning }) {
  return (
    <button onClick={onClick} style={{ background:"none", border:"none", color:"#3db8d4", cursor:"pointer", fontSize:15, padding:0, lineHeight:1, display:"inline-block", animation: spinning?"spin 1s linear infinite":"none", opacity: spinning?0.5:0.8 }}>↺</button>
  );
}

// ── Main component ──────────────────────────────────────────────
export default function Jarvis() {
  const [time, setTime]           = useState(new Date());
  const [weather, setWeather]     = useState(null);
  const [stocks, setStocks]       = useState({});
  const [news, setNews]           = useState(null);
  const [calendar, setCalendar]   = useState(null);
  const [driveNotes, setDriveNotes] = useState(null);
  const [spin, setSpin]           = useState({ w:true, s:true, n:true, c:true, d:true });
  const go  = k => setSpin(p=>({...p,[k]:true}));
  const end = k => setSpin(p=>({...p,[k]:false}));

  // Chat
  const INIT_MSG = { role:"assistant", content:"Good morning, sir. All systems online. What's on your mind?" };
  const [messages, setMessages]   = useState([INIT_MSG]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy]   = useState(false);
  const chatEnd = useRef(null);

  // Briefing
  const [panel, setPanel]           = useState("chat");
  const [briefing, setBriefing]     = useState(null);
  const [briefBusy, setBriefBusy]   = useState(false);

  // Notes
  const [userNotes, setUserNotes]   = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesOpen, setNotesOpen]   = useState(false);

  // Todos
  const [todos, setTodos]     = useState([]);
  const [todoIn, setTodoIn]   = useState("");
  const todoRef = useRef(null);

  // ── Clock
  useEffect(() => {
    const t = setInterval(()=>setTime(new Date()),1000);
    return ()=>clearInterval(t);
  },[]);

  // ── Persistence
  useEffect(()=>{
    (async()=>{
      try {
        const a = await window.storage.get("j-todos-v4"); if(a) setTodos(JSON.parse(a.value));
        const b = await window.storage.get("j-thoughts");  if(b){setUserNotes(b.value);setNotesDraft(b.value);}
      } catch {}
    })();
  },[]);

  const saveTodos = async list => { setTodos(list); try{ await window.storage.set("j-todos-v4",JSON.stringify(list));}catch{} };
  const saveNotes = async txt  => { setUserNotes(txt); try{ await window.storage.set("j-thoughts",txt);}catch{} };

  const addTodo = () => {
    const t = todoIn.trim(); if(!t) return;
    saveTodos([...todos,{id:Date.now(),text:t,done:false}]);
    setTodoIn(""); setTimeout(()=>todoRef.current?.focus(),0);
  };

  // ── Data fetchers
  const fetchWeather = useCallback(async()=>{
    go("w");
    try{
      const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=33.1984&longitude=-96.6398&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph");
      const d = await r.json(); setWeather(d.current??null);
    }catch{}
    end("w");
  },[]);

  const fetchStocks = useCallback(async()=>{
    go("s");
    try{
      const [t1,t2] = await Promise.all([
        apiCall(`Search current stock prices for NVDA,MU,AMSC,SMH,QQQM. Return ONLY JSON array: [{"ticker":"NVDA","price":900.00,"change":5.5,"pct":0.62}]. No markdown.`,{tools:[{type:"web_search_20250305",name:"web_search"}]}),
        apiCall(`Search current stock prices for QQQ,MAGS,QTUM,NUKZ,SPGP. Return ONLY JSON array: [{"ticker":"QQQ","price":450.00,"change":1.2,"pct":0.27}]. No markdown.`,{tools:[{type:"web_search_20250305",name:"web_search"}]}),
      ]);
      const map={};
      [...(parseJSON(t1)??[]),...(parseJSON(t2)??[])].forEach(s=>{map[s.ticker]=s;});
      setStocks(map);
    }catch{}
    end("s");
  },[]);

  const fetchNews = useCallback(async()=>{
    go("n");
    try{
      const txt = await apiCall(`Search today's top 6 financial market news. Focus: AI, semiconductors, Fed, earnings, macro. Return ONLY JSON: [{"headline":"...","source":"...","blurb":"one sentence"}]. No markdown.`,{tools:[{type:"web_search_20250305",name:"web_search"}]});
      const p=parseJSON(txt); if(Array.isArray(p)) setNews(p);
    }catch{}
    end("n");
  },[]);

  const fetchCalendar = useCallback(async()=>{
    go("c");
    try{
      const txt = await apiCall(`List my upcoming Google Calendar events for today and next 7 days. Return ONLY JSON: [{"title":"...","date":"Mon May 12","time":"3:00 PM"}]. Max 8. No markdown.`,{mcp_servers:[{type:"url",url:"https://calendarmcp.googleapis.com/mcp/v1",name:"gcal"}]});
      const p=parseJSON(txt); setCalendar(Array.isArray(p)?p:[]);
    }catch{setCalendar([]);}
    end("c");
  },[]);

  const fetchDrive = useCallback(async()=>{
    go("d");
    try{
      const txt = await apiCall(`Search Google Drive for files named "notes","thoughts","todo","keep in mind","Jarvis Notes". Read most recent. Return ONLY JSON: [{"title":"...","bullets":["..."]}]. Max 4 files, 5 bullets each. No markdown.`,{mcp_servers:[{type:"url",url:"https://drivemcp.googleapis.com/mcp/v1",name:"gdrive"}]});
      const p=parseJSON(txt); setDriveNotes(Array.isArray(p)?p:[]);
    }catch{setDriveNotes([]);}
    end("d");
  },[]);

  useEffect(()=>{ fetchWeather(); fetchStocks(); fetchNews(); fetchCalendar(); fetchDrive(); },[]);

  // ── Scroll chat to bottom
  useEffect(()=>{ chatEnd.current?.scrollIntoView({behavior:"smooth"}); },[messages,chatBusy]);

  const getCtx = () => ({
    weather, stocks: Object.values(stocks), calendar, news, driveNotes, userNotes,
  });

  // ── Send chat message
  const sendMsg = async () => {
    const txt = chatInput.trim(); if(!txt||chatBusy) return;
    const next = [...messages,{role:"user",content:txt}];
    setMessages(next); setChatInput(""); setChatBusy(true);
    try{
      const sys = buildSystem(getCtx());
      const apiMsgs = next.slice(messages[0].role==="assistant"?1:0).map(m=>({role:m.role,content:m.content}));
      const reply = await jarvisCall(apiMsgs, sys);
      setMessages(p=>[...p,{role:"assistant",content:reply}]);
    }catch{
      setMessages(p=>[...p,{role:"assistant",content:"My apologies, sir — brief technical difficulty. Please try again."}]);
    }
    setChatBusy(false);
  };

  // ── Generate briefing
  const genBriefing = async () => {
    setBriefBusy(true); setBriefing(null);
    try{
      const sys = buildSystem(getCtx());
      const reply = await jarvisCall(
        [{role:"user",content:"Generate my full morning briefing. Cover: urgent calendar items and deadlines, important emails needing action, portfolio and market summary, and close with one motivating line. Under 300 words, spoken-word style."}],
        sys,
        {
          max_tokens:600,
          mcp_servers:[
            {type:"url",url:"https://calendarmcp.googleapis.com/mcp/v1",name:"gcal"},
            {type:"url",url:"https://gmailmcp.googleapis.com/mcp/v1",name:"gmail"},
          ],
        }
      );
      setBriefing(reply);
    }catch{setBriefing("Encountered a difficulty, sir. Please try again.");}
    setBriefBusy(false);
  };

  // ── Derived display
  const fmtTime = d => d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  const fmtDate = d => d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  const greet = () => { const h=time.getHours(); return h<12?"Good morning, sir":h<17?"Good afternoon, sir":"Good evening, sir"; };
  const wInfo = weather?.weather_code!==undefined ? getWMO(weather.weather_code) : null;

  return (
    <div style={{ background:"#000", minHeight:"100vh", color:"#cce0f5", fontFamily:"'Inter',-apple-system,sans-serif", padding:14, display:"flex", flexDirection:"column", gap:10 }}>
      <style>{`
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        * { box-sizing:border-box; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-thumb { background:rgba(0,160,220,0.2); border-radius:4px; }
        .msg { animation:fadeUp 0.18s ease; }
        input:focus, textarea:focus { outline:1px solid rgba(0,180,220,0.35) !important; }
      `}</style>

      {/* ── HEADER */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", ...CARD }}>
        <div>
          <div style={{ fontFamily:"monospace", fontSize:28, fontWeight:700, color:"#00d4ff", letterSpacing:3 }}>{fmtTime(time)}</div>
          <div style={{ fontSize:10, color:"#152535", marginTop:2 }}>{fmtDate(time)}</div>
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:24, fontWeight:800, letterSpacing:10, color:"#00d4ff" }}>JARVIS</div>
          <div style={{ fontSize:9, color:"#152535", letterSpacing:3, marginTop:2 }}>PERSONAL AI · UTD FINANCE · MCKINNEY TX</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:14, fontWeight:600, color:"#a0c0e8" }}>{greet()}</div>
          <div style={{ fontSize:10, color:"#152535", marginTop:2 }}>micro1 · Bubba's Fireworks · Portfolio</div>
        </div>
      </div>

      {/* ── EXAM COUNTDOWNS */}
      <div style={{ display:"flex", gap:10 }}>
        {EXAMS.map(e=>{
          const d=daysUntil(e.date);
          const label = d<0?"Complete ✓":d===0?"TODAY ⚠️":d===1?"Tomorrow":`${d} days`;
          const urgent = d>=0&&d<=1;
          return (
            <div key={e.name} style={{ flex:1, ...CARD, padding:"7px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", borderLeft:`3px solid ${e.color}`, paddingLeft:12, borderRadius:10 }}>
              <span style={{ fontSize:11, fontWeight:600, color:"#80a0c0" }}>{e.name}</span>
              <span style={{ fontSize:12, fontWeight:800, color: urgent?e.color:"#506070", fontFamily:"monospace" }}>{label}</span>
            </div>
          );
        })}
      </div>

      {/* ── MAIN GRID */}
      <div style={{ display:"grid", gridTemplateColumns:"200px 1fr 200px", gap:10 }}>

        {/* LEFT COL */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

          {/* Weather */}
          <div style={CARD}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={LABEL}>🌡️ McKinney TX</span>
              <RefBtn onClick={fetchWeather} spinning={spin.w} />
            </div>
            {weather ? (
              <>
                <div style={{ fontSize:36, fontWeight:800, color:"#00d4ff", fontFamily:"monospace", lineHeight:1 }}>{Math.round(weather.temperature_2m)}°F</div>
                {wInfo&&<div style={{ fontSize:12, marginTop:4, color:"#70a0c0" }}>{wInfo[1]} {wInfo[0]}</div>}
                <div style={{ fontSize:10, color:"#152535", marginTop:5 }}>Feels {Math.round(weather.apparent_temperature)}°F · {Math.round(weather.wind_speed_10m)} mph</div>
              </>
            ):<div style={DIM}>{spin.w?"Loading...":"—"}</div>}
          </div>

          {/* Tasks */}
          <div style={{ ...CARD, flex:1 }}>
            <div style={{ ...LABEL, marginBottom:8 }}>📋 Tasks</div>
            <div style={{ display:"flex", gap:5, marginBottom:8 }}>
              <input ref={todoRef} value={todoIn} onChange={e=>setTodoIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTodo()} placeholder="Add task..." style={{ flex:1, background:"#1a1a1a", border:"1px solid #1a3040", borderRadius:6, padding:"5px 8px", color:"#cce0f5", fontSize:11, outline:"none", fontFamily:"inherit" }} />
              <button onClick={addTodo} style={{ background:"#0a2030", border:"1px solid #1a4060", borderRadius:6, color:"#00d4ff", padding:"5px 9px", cursor:"pointer", fontSize:15 }}>+</button>
            </div>
            {todos.length===0&&<div style={DIM}>No tasks yet</div>}
            {todos.map((t,i)=>(
              <div key={t.id} style={{ display:"flex", alignItems:"flex-start", gap:6, padding:"4px 0", borderBottom:i<todos.length-1?"1px solid #0d1a22":"none" }}>
                <input type="checkbox" checked={t.done} onChange={()=>saveTodos(todos.map(x=>x.id===t.id?{...x,done:!x.done}:x))} style={{ cursor:"pointer", accentColor:"#00d4ff", marginTop:2, flexShrink:0 }}/>
                <span style={{ flex:1, fontSize:11, color:t.done?"#1a2530":"#90b8d8", textDecoration:t.done?"line-through":"none", lineHeight:"1.4" }}>{t.text}</span>
                <button onClick={()=>saveTodos(todos.filter(x=>x.id!==t.id))} style={{ background:"none", border:"none", color:"#201010", cursor:"pointer", fontSize:15, padding:0, lineHeight:1 }}>×</button>
              </div>
            ))}
          </div>

          {/* My Thoughts */}
          <div style={CARD}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:notesOpen?8:0 }}>
              <span style={LABEL}>💭 My Thoughts</span>
              <button onClick={()=>setNotesOpen(o=>!o)} style={{ background:"none", border:"none", color:"#3db8d4", cursor:"pointer", fontSize:11, padding:0 }}>{notesOpen?"▲ hide":"▼ edit"}</button>
            </div>
            {notesOpen ? (
              <>
                <textarea value={notesDraft} onChange={e=>setNotesDraft(e.target.value)} placeholder="Write here — Jarvis reads these in context..." style={{ width:"100%", height:75, background:"#1a1a1a", border:"1px solid #1a3040", borderRadius:6, padding:"6px 8px", color:"#cce0f5", fontSize:11, outline:"none", resize:"none", fontFamily:"inherit", lineHeight:"1.5" }} />
                <button onClick={()=>{saveNotes(notesDraft);setNotesOpen(false);}} style={{ marginTop:5, width:"100%", background:"rgba(0,150,210,0.12)", border:"1px solid rgba(0,150,210,0.25)", borderRadius:6, color:"#00d4ff", padding:"5px", cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>Save to Jarvis</button>
              </>
            ) : (
              <div style={{ fontSize:11, color:"#3a5870", lineHeight:"1.5", maxHeight:60, overflow:"hidden" }}>{userNotes||<span style={DIM}>Tap edit to add thoughts Jarvis will remember</span>}</div>
            )}
          </div>
        </div>

        {/* CENTER: Chat + Briefing */}
        <div style={{ ...CARD, padding:0, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:500 }}>

          {/* Tab bar */}
          <div style={{ display:"flex", borderBottom:"1px solid #1a2e3a", flexShrink:0 }}>
            {[["chat","💬 Chat with Jarvis"],["briefing","📋 Morning Brief"]].map(([id,label])=>(
              <button key={id} onClick={()=>{setPanel(id);if(id==="briefing"&&!briefing&&!briefBusy)genBriefing();}}
                style={{ flex:1, padding:"11px", background:panel===id?"#0f1a22":"none", border:"none", borderBottom:panel===id?"2px solid #00d4ff":"2px solid transparent", color:panel===id?"#00d4ff":"#2a4060", cursor:"pointer", fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", fontFamily:"inherit", transition:"all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>

          {/* CHAT */}
          {panel==="chat"&&(
            <>
              <div style={{ flex:1, overflowY:"auto", padding:14, display:"flex", flexDirection:"column", gap:10 }}>
                {messages.map((m,i)=>(
                  <div key={i} className="msg" style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
                    <div style={{
                      maxWidth:"82%", padding:"9px 13px", fontSize:12, lineHeight:"1.6", whiteSpace:"pre-wrap",
                      borderRadius:m.role==="user"?"12px 12px 2px 12px":"2px 12px 12px 12px",
                      background:m.role==="user"?"rgba(0,150,210,0.18)":"#111",
                      border:m.role==="user"?"1px solid rgba(0,150,210,0.28)":"1px solid #1a2e3a",
                      color:m.role==="user"?"#b8d8f8":"#90b0cc",
                    }}>{m.content}</div>
                  </div>
                ))}
                {chatBusy&&(
                  <div style={{ display:"flex", justifyContent:"flex-start" }}>
                    <div style={{ padding:"9px 14px", borderRadius:"2px 12px 12px 12px", background:"#111", border:"1px solid #1a2e3a", color:"#3db8d4", fontSize:12 }}>
                      <span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>◌</span> &nbsp;Jarvis is thinking...
                    </div>
                  </div>
                )}
                <div ref={chatEnd}/>
              </div>

              {/* Suggested prompts */}
              {messages.length<=2&&(
                <div style={{ padding:"0 14px 10px", display:"flex", gap:6, flexWrap:"wrap" }}>
                  {["How's my portfolio today?","What do I need to do today?","What's the market doing?","Give me a quick market read"].map(p=>(
                    <button key={p} onClick={()=>{setChatInput(p);}} style={{ background:"rgba(0,150,210,0.1)", border:"1px solid rgba(0,150,210,0.2)", borderRadius:6, color:"#4090c0", padding:"4px 10px", cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>{p}</button>
                  ))}
                </div>
              )}

              <div style={{ padding:"10px 14px", borderTop:"1px solid #1a2e3a", display:"flex", gap:8, flexShrink:0 }}>
                <input
                  value={chatInput} onChange={e=>setChatInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendMsg()}
                  placeholder="Ask Jarvis anything... (Enter to send)"
                  disabled={chatBusy}
                  style={{ flex:1, background:"#1a1a1a", border:"1px solid #1a3040", borderRadius:8, padding:"9px 12px", color:"#cce0f5", fontSize:12, outline:"none", fontFamily:"inherit", opacity:chatBusy?0.6:1 }}
                />
                <button onClick={sendMsg} disabled={chatBusy} style={{ background:"rgba(0,150,210,0.18)", border:"1px solid rgba(0,150,210,0.35)", borderRadius:8, color:"#00d4ff", padding:"9px 14px", cursor:"pointer", fontSize:15, opacity:chatBusy?0.5:1 }}>➤</button>
              </div>
            </>
          )}

          {/* BRIEFING */}
          {panel==="briefing"&&(
            <div style={{ flex:1, overflowY:"auto", padding:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <span style={{ fontSize:10, color:"#1a3040", letterSpacing:"1px" }}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</span>
                <button onClick={genBriefing} disabled={briefBusy} style={{ background:"rgba(0,150,210,0.1)", border:"1px solid rgba(0,150,210,0.25)", borderRadius:6, color:"#00d4ff", padding:"4px 12px", cursor:"pointer", fontSize:10, opacity:briefBusy?0.5:1 }}>
                  {briefBusy?"Generating...":"↺ New Briefing"}
                </button>
              </div>
              {briefBusy&&<div style={DIM}>Jarvis is preparing your briefing, sir...</div>}
              {briefing&&<div style={{ fontSize:13, lineHeight:"1.9", color:"#80a8c8", whiteSpace:"pre-wrap" }}>{briefing}</div>}
              {!briefing&&!briefBusy&&<div style={DIM}>Click "New Briefing" to generate your morning briefing</div>}
            </div>
          )}
        </div>

        {/* RIGHT COL */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

          {/* Portfolio */}
          <div style={CARD}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={LABEL}>📈 Portfolio · 1D</span>
              <RefBtn onClick={fetchStocks} spinning={spin.s} />
            </div>
            {GROUPS.map(g=>(
              <div key={g.label} style={{ marginBottom:8 }}>
                <div style={{ fontSize:8, color:"#1a3040", letterSpacing:"1px", textTransform:"uppercase", marginBottom:3, borderBottom:"1px solid #0d1a22", paddingBottom:2 }}>{g.label}</div>
                {g.tickers.map(ticker=>{
                  const s=stocks[ticker];
                  const pos=s?Number(s.change)>=0:true;
                  const col=pos?"#22c55e":"#ef4444";
                  return(
                    <div key={ticker} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0", borderBottom:"1px solid #080e14" }}>
                      <span style={{ fontFamily:"monospace", fontWeight:700, fontSize:11, color:"#d0e8ff" }}>{ticker}</span>
                      <div style={{ textAlign:"right" }}>
                        {s?(
                          <>
                            <div style={{ fontFamily:"monospace", fontSize:10, color:"#708090" }}>${Number(s.price).toFixed(2)}</div>
                            <div style={{ fontFamily:"monospace", fontSize:10, color:col }}>{pos?"▲":""}{Number(s.pct).toFixed(2)}%</div>
                          </>
                        ):<span style={{ fontSize:10, color:"#1a3040" }}>—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {spin.s&&!Object.keys(stocks).length&&<div style={DIM}>Fetching prices...</div>}
          </div>

          {/* Calendar */}
          <div style={CARD}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={LABEL}>📅 Calendar</span>
              <RefBtn onClick={fetchCalendar} spinning={spin.c} />
            </div>
            {Array.isArray(calendar)?calendar.length>0?calendar.map((e,i)=>(
              <div key={i} style={{ padding:"5px 0", borderBottom:i<calendar.length-1?"1px solid #0d1a22":"none" }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#a0c0e0", lineHeight:"1.35" }}>{e.title}</div>
                <div style={{ fontSize:9, color:"#00a8cc", marginTop:2 }}>{e.date}{e.time?` · ${e.time}`:""}</div>
              </div>
            )):<div style={DIM}>No upcoming events</div>
            :<div style={DIM}>{spin.c?"Loading...":"—"}</div>}
          </div>

          {/* Drive Notes */}
          <div style={{ ...CARD, flex:1 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={LABEL}>📝 Drive Notes</span>
              <RefBtn onClick={fetchDrive} spinning={spin.d} />
            </div>
            {Array.isArray(driveNotes)?driveNotes.length>0?driveNotes.map((n,i)=>(
              <div key={i} style={{ marginBottom:10 }}>
                <div style={{ fontSize:9, fontWeight:700, color:"#00a8cc", letterSpacing:"1px", textTransform:"uppercase", marginBottom:4 }}>{n.title}</div>
                {(n.bullets||[]).map((b,j)=>(
                  <div key={j} style={{ fontSize:10, color:"#2a4858", padding:"2px 0 2px 8px", borderLeft:"2px solid #0d2030", marginBottom:3, lineHeight:"1.4" }}>{b}</div>
                ))}
              </div>
            )):<div style={DIM}>No notes found in Drive</div>
            :<div style={DIM}>{spin.d?"Scanning Drive...":"—"}</div>}
          </div>
        </div>
      </div>

      {/* ── NEWS */}
      <div style={{ ...CARD }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <span style={LABEL}>📰 Market News</span>
          <RefBtn onClick={fetchNews} spinning={spin.n} />
        </div>
        {Array.isArray(news)?(
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {news.map((n,i)=>(
              <div key={i} style={{ background:"#111", border:"1px solid #141e26", borderRadius:8, padding:"10px 12px" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#fff", lineHeight:"1.4", marginBottom:4 }}>{n.headline}</div>
                <div style={{ fontSize:9, color:"#1a3048", fontWeight:700, letterSpacing:"0.5px", textTransform:"uppercase", marginBottom:4 }}>{n.source}</div>
                {n.blurb&&<div style={{ fontSize:10, color:"#3a5870", lineHeight:"1.4" }}>{n.blurb}</div>}
              </div>
            ))}
          </div>
        ):<div style={DIM}>{spin.n?"Searching headlines...":"—"}</div>}
      </div>
    </div>
  );
}
