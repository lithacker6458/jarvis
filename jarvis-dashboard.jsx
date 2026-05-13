import { useState, useEffect, useCallback, useRef } from "react";

const MODEL = "claude-sonnet-4-6";

const GROUPS = [
  { label: "Core",     tickers: ["NVDA","MU","AMSC"] },
  { label: "ETFs",     tickers: ["SMH","QQQM","QQQ","MAGS"] },
  { label: "Thematic", tickers: ["QTUM","NUKZ","SPGP"] },
];

const WMO = {
  0:["Clear","☀️"],1:["Mainly Clear","🌤️"],2:["Partly Cloudy","⛅"],3:["Overcast","☁️"],
  45:["Foggy","🌫️"],51:["Drizzle","🌦️"],61:["Light Rain","🌧️"],63:["Rain","🌧️"],
  80:["Showers","🌦️"],95:["Thunderstorm","⛈️"],
};
const getWMO = c => WMO[c] || WMO[Math.floor(c/10)*10] || ["Unknown","🌡️"];

const EXAM_COLORS = ["#ef4444","#f59e0b","#8b5cf6","#06b6d4"];

async function apiCall(prompt, extras = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:MODEL, max_tokens:1000, messages:[{role:"user",content:prompt}], ...extras }),
  });
  const d = await res.json();
  return (d.content??[]).filter(b=>b.type==="text").map(b=>b.text).join("");
}

async function jarvisCall(messages, system, extras = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:MODEL, max_tokens:900, system, messages, ...extras }),
  });
  const d = await res.json();
  return (d.content??[]).filter(b=>b.type==="text").map(b=>b.text).join("");
}

function parseJSON(txt) {
  try {
    const c = txt.replace(/```json|```/g,"").trim();
    const m = c.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

function daysUntil(d) {
  const t=new Date(); t.setHours(0,0,0,0);
  const x=new Date(d); x.setHours(0,0,0,0);
  return Math.round((x-t)/86400000);
}

const JARVIS_BASE = `You are Jarvis — the personal AI assistant of Anish Kumar Boddu. Sharp, dry-witted, British sensibility. Loyal and genuinely invested in his success.

Anish: 20yo, UTD sophomore, Finance BS (Investment Concentration), graduating May 2028. Runs Bubba's Fireworks (seasonal). Works at micro1 as AI Evaluation Specialist. Active investor (AI/semis focus: NVDA, MU, AMSC, SMH, QQQM, QQQ, MAGS, QTUM, NUKZ, SPGP). On a fitness cut. Birthday August 1st. McKinney TX.

Style: "sir" 2-3x per response naturally. Concise unless detail requested. Dry wit when appropriate.`;

function buildSystem(ctx) {
  const lines = [JARVIS_BASE, "\n\nLIVE CONTEXT:"];
  if (ctx.weather) { const wi=getWMO(ctx.weather.weather_code); lines.push(`Weather: ${Math.round(ctx.weather.temperature_2m)}°F ${wi[0]}, feels ${Math.round(ctx.weather.apparent_temperature)}°F`); }
  if (ctx.stocks?.length) lines.push(`Portfolio 1D: ${ctx.stocks.map(s=>`${s.ticker} ${Number(s.pct)>=0?"+":""}${Number(s.pct).toFixed(2)}%`).join(", ")}`);
  if (ctx.calendar?.length) lines.push(`Calendar: ${ctx.calendar.map(e=>`${e.title} (${e.date})`).join("; ")}`);
  if (ctx.exams?.length) lines.push(`Upcoming exams: ${ctx.exams.map(e=>`${e.name} in ${daysUntil(e.date)} days`).join("; ")}`);
  if (ctx.news?.length) lines.push(`News: ${ctx.news.map(n=>n.headline).join(" | ")}`);
  if (ctx.userNotes) lines.push(`Anish's notes: ${ctx.userNotes}`);
  return lines.join("\n");
}

// ── Shared styles
const C = {
  card: { background:"#0d0d0d", border:"1px solid #1c2e3a", borderRadius:12, padding:12, marginBottom:10 },
  label: { fontSize:9, fontWeight:700, letterSpacing:"1.8px", color:"#3db8d4", textTransform:"uppercase" },
  dim: { fontSize:11, color:"#253545", fontStyle:"italic" },
  pos: "#22c55e", neg: "#ef4444",
};

function Spin({ onClick, spinning }) {
  return <button onClick={onClick} style={{ background:"none", border:"none", color:"#3db8d4", cursor:"pointer", fontSize:15, padding:0, lineHeight:1, display:"inline-block", animation:spinning?"spin 1s linear infinite":"none", opacity:spinning?0.5:0.8 }}>↺</button>;
}

export default function Jarvis() {
  const [time, setTime]           = useState(new Date());
  const [weather, setWeather]     = useState(null);
  const [stocks, setStocks]       = useState({});
  const [stockTime, setStockTime] = useState(null);
  const [news, setNews]           = useState(null);
  const [calendar, setCalendar]   = useState(null);
  const [exams, setExams]         = useState([]);
  const [driveNotes, setDriveNotes] = useState(null);
  const [spin, setSpin]           = useState({w:true,s:true,n:true,c:true,e:true,d:true});
  const go  = k => setSpin(p=>({...p,[k]:true}));
  const end = k => setSpin(p=>({...p,[k]:false}));

  // Chat
  const [msgs, setMsgs]       = useState([{role:"assistant",content:"Online and standing by, sir."}]);
  const [chatIn, setChatIn]   = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEnd = useRef(null);

  // Briefing
  const [panel, setPanel]       = useState("chat");
  const [brief, setBrief]       = useState(null);
  const [briefBusy, setBriefBusy] = useState(false);

  // Notes & todos
  const [userNotes, setUserNotes] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [todos, setTodos]   = useState([]);
  const [todoIn, setTodoIn] = useState("");
  const todoRef = useRef(null);

  useEffect(() => { const t=setInterval(()=>setTime(new Date()),1000); return()=>clearInterval(t); },[]);

  useEffect(() => {
    (async()=>{
      try {
        const a=await window.storage.get("j-todos-v5"); if(a) setTodos(JSON.parse(a.value));
        const b=await window.storage.get("j-thoughts-v2"); if(b){setUserNotes(b.value);setNotesDraft(b.value);}
      } catch {}
    })();
  },[]);

  const saveTodos = async l => { setTodos(l); try{await window.storage.set("j-todos-v5",JSON.stringify(l));}catch{} };
  const saveNotes = async t => { setUserNotes(t); try{await window.storage.set("j-thoughts-v2",t);}catch{} };
  const addTodo = () => { const t=todoIn.trim(); if(!t)return; saveTodos([...todos,{id:Date.now(),text:t,done:false}]); setTodoIn(""); setTimeout(()=>todoRef.current?.focus(),0); };

  // ── FETCHERS ──────────────────────────────────────────────────

  const fetchWeather = useCallback(async()=>{
    go("w");
    try {
      const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=33.1984&longitude=-96.6398&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph");
      const d = await r.json(); setWeather(d.current??null);
    } catch {}
    end("w");
  },[]);

  const fetchStocks = useCallback(async()=>{
    go("s");
    try {
      const now = new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"});
      const [t1,t2] = await Promise.all([
        apiCall(`Search for TODAY's (${now}) stock prices and daily percent change for: NVDA, MU, AMSC, SMH, QQQM. Get the most current market data available. Return ONLY JSON array: [{"ticker":"NVDA","price":219.48,"change":-2.10,"pct":-0.95}]. No markdown. Include negative values if stocks are down.`,{tools:[{type:"web_search_20250305",name:"web_search"}]}),
        apiCall(`Search for TODAY's (${now}) stock prices and daily percent change for: QQQ, MAGS, QTUM, NUKZ, SPGP. Get the most current market data available. Return ONLY JSON array: [{"ticker":"QQQ","price":450.00,"change":-1.20,"pct":-0.27}]. No markdown. Include negative values if stocks are down.`,{tools:[{type:"web_search_20250305",name:"web_search"}]}),
      ]);
      const map={};
      [...(parseJSON(t1)??[]),...(parseJSON(t2)??[])].forEach(s=>{map[s.ticker]=s;});
      setStocks(map);
      setStockTime(new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}));
    } catch {}
    end("s");
  },[]);

  const fetchNews = useCallback(async()=>{
    go("n");
    try {
      const txt = await apiCall(`Search for today's top 6 financial market news right now. AI, semiconductors, Fed, earnings, macro. Return ONLY JSON: [{"headline":"...","source":"...","blurb":"one sentence"}]. No markdown.`,{tools:[{type:"web_search_20250305",name:"web_search"}]});
      const p=parseJSON(txt); if(Array.isArray(p)) setNews(p);
    } catch {}
    end("n");
  },[]);

  const fetchCalendar = useCallback(async()=>{
    go("c");
    try {
      const txt = await apiCall(`Check my Google Calendar and list ALL events from today through the next 14 days. Include everything — classes, meetings, deadlines, exams, personal events. Return ONLY JSON: [{"title":"...","date":"Tue May 12","time":"10:00 AM"}]. Max 12 events. No markdown.`,{mcp_servers:[{type:"url",url:"https://calendarmcp.googleapis.com/mcp/v1",name:"gcal"}]});
      const p=parseJSON(txt); setCalendar(Array.isArray(p)?p:[]);
    } catch { setCalendar([]); }
    end("c");
  },[]);

  const fetchExams = useCallback(async()=>{
    go("e");
    try {
      const txt = await apiCall(`Search my Google Calendar for any upcoming events in the next 60 days that contain the words "exam", "midterm", "final", "quiz", or "test" in the title. Return ONLY JSON: [{"name":"FIN 4300 Midterm 3","date":"2026-05-14"}]. Max 5 results. No markdown.`,{mcp_servers:[{type:"url",url:"https://calendarmcp.googleapis.com/mcp/v1",name:"gcal"}]});
      const p=parseJSON(txt); if(Array.isArray(p)) setExams(p);
    } catch {}
    end("e");
  },[]);

  const fetchDrive = useCallback(async()=>{
    go("d");
    try {
      const txt = await apiCall(`Search Google Drive for files named "notes","thoughts","todo","Jarvis Notes","keep in mind". Read most recent. Return ONLY JSON: [{"title":"...","bullets":["..."]}]. Max 4 files, 5 bullets each. No markdown.`,{mcp_servers:[{type:"url",url:"https://drivemcp.googleapis.com/mcp/v1",name:"gdrive"}]});
      const p=parseJSON(txt); setDriveNotes(Array.isArray(p)?p:[]);
    } catch { setDriveNotes([]); }
    end("d");
  },[]);

  useEffect(()=>{ fetchWeather(); fetchStocks(); fetchNews(); fetchCalendar(); fetchExams(); fetchDrive(); },[]);
  useEffect(()=>{ chatEnd.current?.scrollIntoView({behavior:"smooth"}); },[msgs,chatBusy]);

  const getCtx = () => ({ weather, stocks:Object.values(stocks), calendar, exams, news, driveNotes, userNotes });

  const sendMsg = async () => {
    const txt=chatIn.trim(); if(!txt||chatBusy) return;
    const next=[...msgs,{role:"user",content:txt}];
    setMsgs(next); setChatIn(""); setChatBusy(true);
    try {
      const sys=buildSystem(getCtx());
      const apiMsgs=next.slice(1).map(m=>({role:m.role,content:m.content}));
      const reply=await jarvisCall(apiMsgs.length?apiMsgs:[{role:"user",content:txt}],sys);
      setMsgs(p=>[...p,{role:"assistant",content:reply}]);
    } catch { setMsgs(p=>[...p,{role:"assistant",content:"Brief technical difficulty, sir. Please try again."}]); }
    setChatBusy(false);
  };

  const genBrief = async () => {
    setBriefBusy(true); setBrief(null);
    try {
      const sys=buildSystem(getCtx());
      const reply=await jarvisCall(
        [{role:"user",content:"Generate my full morning briefing. Cover: upcoming exams and deadlines with urgency, action-needed emails, portfolio performance summary for the day, key market news, and close with one sharp motivating line. Under 350 words, spoken-word style, no markdown headers."}],
        sys,
        { max_tokens:650, mcp_servers:[{type:"url",url:"https://calendarmcp.googleapis.com/mcp/v1",name:"gcal"},{type:"url",url:"https://gmailmcp.googleapis.com/mcp/v1",name:"gmail"}] }
      );
      setBrief(reply);
    } catch { setBrief("Encountered a difficulty, sir. Please try again."); }
    setBriefBusy(false);
  };

  // ── Derived ──────────────────────────────────────────────────
  const fmtTime = d=>d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  const fmtDate = d=>d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  const greet = () => { const h=time.getHours(); return h<12?"Good morning, sir":h<17?"Good afternoon, sir":"Good evening, sir"; };
  const wInfo = weather?.weather_code!==undefined ? getWMO(weather.weather_code) : null;

  // Portfolio summary
  const stockList = Object.values(stocks).filter(s=>s.pct!=null);
  const best  = stockList.length ? stockList.reduce((a,b)=>Number(a.pct)>Number(b.pct)?a:b) : null;
  const worst = stockList.length ? stockList.reduce((a,b)=>Number(a.pct)<Number(b.pct)?a:b) : null;
  const allRed = stockList.length > 0 && stockList.every(s=>Number(s.pct)<0);
  const allGreen = stockList.length > 0 && stockList.every(s=>Number(s.pct)>0);

  return (
    <div style={{ background:"#000", minHeight:"100vh", color:"#cce0f5", fontFamily:"'Inter',-apple-system,sans-serif", padding:14, display:"flex", flexDirection:"column", gap:10 }}>
      <style>{`
        @keyframes spin { to{transform:rotate(360deg);} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(5px);} to{opacity:1;transform:translateY(0);} }
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:rgba(0,160,220,0.2);border-radius:4px;}
        .msg{animation:fadeUp 0.15s ease;}
        input:focus,textarea:focus{outline:1px solid rgba(0,180,220,0.35)!important;}
      `}</style>

      {/* ── HEADER */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", ...C.card, marginBottom:0 }}>
        <div>
          <div style={{ fontFamily:"monospace", fontSize:26, fontWeight:700, color:"#00d4ff", letterSpacing:3 }}>{fmtTime(time)}</div>
          <div style={{ fontSize:10, color:"#152535", marginTop:2 }}>{fmtDate(time)}</div>
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, letterSpacing:10, color:"#00d4ff" }}>JARVIS</div>
          <div style={{ fontSize:9, color:"#152535", letterSpacing:3 }}>PERSONAL AI · UTD FINANCE · MCKINNEY TX</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:14, fontWeight:600, color:"#90b8e0" }}>{greet()}</div>
          <div style={{ fontSize:10, color:"#152535", marginTop:2 }}>micro1 · Bubba's Fireworks · Schwab Portfolio</div>
        </div>
      </div>

      {/* ── EXAM COUNTDOWNS (adaptive from calendar) */}
      {exams.length > 0 && (
        <div style={{ display:"flex", gap:10 }}>
          {exams.map((e,i)=>{
            const d=daysUntil(e.date);
            const col=EXAM_COLORS[i%EXAM_COLORS.length];
            const label=d<0?"✓ Done":d===0?"TODAY ⚠️":d===1?"Tomorrow":`${d} days`;
            const urgent=d>=0&&d<=2;
            return (
              <div key={i} style={{ flex:1, ...C.card, marginBottom:0, padding:"7px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", borderLeft:`3px solid ${col}`, borderRadius:10 }}>
                <span style={{ fontSize:11, fontWeight:600, color:"#80a0c0" }}>{e.name}</span>
                <span style={{ fontSize:12, fontWeight:800, color:urgent?col:"#506070", fontFamily:"monospace" }}>{label}</span>
              </div>
            );
          })}
          <button onClick={fetchExams} style={{ background:"none", border:"1px solid #1a2e3a", borderRadius:10, color:"#3db8d4", padding:"0 10px", cursor:"pointer", fontSize:14, display:"inline-block", animation:spin.e?"spin 1s linear infinite":"none" }}>↺</button>
        </div>
      )}
      {exams.length===0&&!spin.e&&(
        <div style={{ ...C.card, marginBottom:0, padding:"7px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={C.dim}>No upcoming exams found in calendar</span>
          <button onClick={fetchExams} style={{ background:"none", border:"none", color:"#3db8d4", cursor:"pointer", fontSize:14 }}>↺ Check calendar</button>
        </div>
      )}

      {/* ── PORTFOLIO SUMMARY BAR */}
      {stockList.length > 0 && (
        <div style={{ ...C.card, marginBottom:0, padding:"8px 14px", display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"1.5px", color:"#3db8d4", textTransform:"uppercase", flexShrink:0 }}>
            Today's Market
          </span>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:10, color:"#405060" }}>Day:</span>
            <span style={{ fontSize:11, fontWeight:700, color: allRed?"#ef4444":allGreen?"#22c55e":"#d0a020" }}>
              {allRed?"🔴 Red day":allGreen?"🟢 Green day":"🟡 Mixed"}
            </span>
          </div>
          {best&&<div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ fontSize:10, color:"#405060" }}>Best:</span>
            <span style={{ fontFamily:"monospace", fontSize:11, fontWeight:700, color:C.pos }}>{best.ticker} +{Number(best.pct).toFixed(2)}%</span>
          </div>}
          {worst&&<div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ fontSize:10, color:"#405060" }}>Worst:</span>
            <span style={{ fontFamily:"monospace", fontSize:11, fontWeight:700, color:C.neg }}>{worst.ticker} {Number(worst.pct).toFixed(2)}%</span>
          </div>}
          {stockTime&&<span style={{ fontSize:9, color:"#1a2e3a", marginLeft:"auto" }}>Last fetched {stockTime}</span>}
        </div>
      )}

      {/* ── MAIN GRID */}
      <div style={{ display:"grid", gridTemplateColumns:"196px 1fr 196px", gap:10 }}>

        {/* LEFT */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

          {/* Weather */}
          <div style={C.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={C.label}>🌡️ McKinney TX</span>
              <Spin onClick={fetchWeather} spinning={spin.w}/>
            </div>
            {weather?(
              <>
                <div style={{ fontSize:38, fontWeight:800, color:"#00d4ff", fontFamily:"monospace", lineHeight:1 }}>{Math.round(weather.temperature_2m)}°F</div>
                {wInfo&&<div style={{ fontSize:13, marginTop:5, color:"#70a0c0" }}>{wInfo[1]} {wInfo[0]}</div>}
                <div style={{ fontSize:10, color:"#1a2e40", marginTop:6 }}>Feels {Math.round(weather.apparent_temperature)}°F · Wind {Math.round(weather.wind_speed_10m)} mph</div>
              </>
            ):<div style={C.dim}>{spin.w?"Loading...":"—"}</div>}
          </div>

          {/* Tasks */}
          <div style={{ ...C.card, flex:1 }}>
            <div style={{ ...C.label, marginBottom:8 }}>📋 Tasks</div>
            <div style={{ display:"flex", gap:5, marginBottom:8 }}>
              <input ref={todoRef} value={todoIn} onChange={e=>setTodoIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTodo()} placeholder="Add task..." style={{ flex:1, background:"#111", border:"1px solid #1a3040", borderRadius:6, padding:"5px 8px", color:"#cce0f5", fontSize:11, outline:"none", fontFamily:"inherit" }}/>
              <button onClick={addTodo} style={{ background:"#0a2030", border:"1px solid #1a4060", borderRadius:6, color:"#00d4ff", padding:"5px 9px", cursor:"pointer", fontSize:15 }}>+</button>
            </div>
            {todos.length===0&&<div style={C.dim}>No tasks yet</div>}
            {todos.map((t,i)=>(
              <div key={t.id} style={{ display:"flex", alignItems:"flex-start", gap:6, padding:"4px 0", borderBottom:i<todos.length-1?"1px solid #0d1520":"none" }}>
                <input type="checkbox" checked={t.done} onChange={()=>saveTodos(todos.map(x=>x.id===t.id?{...x,done:!x.done}:x))} style={{ cursor:"pointer", accentColor:"#00d4ff", marginTop:2, flexShrink:0 }}/>
                <span style={{ flex:1, fontSize:11, color:t.done?"#1a2530":"#90b8d8", textDecoration:t.done?"line-through":"none", lineHeight:"1.4" }}>{t.text}</span>
                <button onClick={()=>saveTodos(todos.filter(x=>x.id!==t.id))} style={{ background:"none", border:"none", color:"#201010", cursor:"pointer", fontSize:15, padding:0, lineHeight:1 }}>×</button>
              </div>
            ))}
          </div>

          {/* Thoughts */}
          <div style={C.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:notesOpen?8:0 }}>
              <span style={C.label}>💭 Thoughts</span>
              <button onClick={()=>setNotesOpen(o=>!o)} style={{ background:"none", border:"none", color:"#3db8d4", cursor:"pointer", fontSize:11, padding:0 }}>{notesOpen?"▲ done":"▼ edit"}</button>
            </div>
            {notesOpen?(
              <>
                <textarea value={notesDraft} onChange={e=>setNotesDraft(e.target.value)} placeholder="Write thoughts — Jarvis reads these..." style={{ width:"100%", height:70, background:"#111", border:"1px solid #1a3040", borderRadius:6, padding:"6px 8px", color:"#cce0f5", fontSize:11, outline:"none", resize:"none", fontFamily:"inherit", lineHeight:"1.5" }}/>
                <button onClick={()=>{saveNotes(notesDraft);setNotesOpen(false);}} style={{ marginTop:5, width:"100%", background:"rgba(0,150,210,0.12)", border:"1px solid rgba(0,150,210,0.25)", borderRadius:6, color:"#00d4ff", padding:5, cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>Save to Jarvis</button>
              </>
            ):(
              <div style={{ fontSize:11, color:"#3a5870", lineHeight:"1.5", maxHeight:55, overflow:"hidden" }}>{userNotes||<span style={C.dim}>Tap edit — Jarvis reads these</span>}</div>
            )}
          </div>
        </div>

        {/* CENTER: Chat / Brief */}
        <div style={{ ...C.card, padding:0, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:520 }}>
          <div style={{ display:"flex", borderBottom:"1px solid #1a2e3a", flexShrink:0 }}>
            {[["chat","💬 Chat with Jarvis"],["briefing","📋 Morning Brief"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>{setPanel(id);if(id==="briefing"&&!brief&&!briefBusy)genBrief();}}
                style={{ flex:1, padding:11, background:panel===id?"#0f1a22":"none", border:"none", borderBottom:panel===id?"2px solid #00d4ff":"2px solid transparent", color:panel===id?"#00d4ff":"#2a4060", cursor:"pointer", fontSize:10, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", fontFamily:"inherit" }}>
                {lbl}
              </button>
            ))}
          </div>

          {panel==="chat"&&(
            <>
              <div style={{ flex:1, overflowY:"auto", padding:14, display:"flex", flexDirection:"column", gap:10 }}>
                {msgs.map((m,i)=>(
                  <div key={i} className="msg" style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
                    <div style={{ maxWidth:"82%", padding:"9px 13px", fontSize:12, lineHeight:"1.6", whiteSpace:"pre-wrap", borderRadius:m.role==="user"?"12px 12px 2px 12px":"2px 12px 12px 12px", background:m.role==="user"?"rgba(0,150,210,0.18)":"#111", border:m.role==="user"?"1px solid rgba(0,150,210,0.28)":"1px solid #1a2e3a", color:m.role==="user"?"#b8d8f8":"#90b0cc" }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatBusy&&(
                  <div style={{ display:"flex" }}>
                    <div style={{ padding:"9px 14px", borderRadius:"2px 12px 12px 12px", background:"#111", border:"1px solid #1a2e3a", color:"#3db8d4", fontSize:12 }}>
                      <span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>◌</span>&nbsp; Jarvis is thinking...
                    </div>
                  </div>
                )}
                <div ref={chatEnd}/>
              </div>
              {msgs.length<=2&&(
                <div style={{ padding:"0 14px 10px", display:"flex", gap:6, flexWrap:"wrap" }}>
                  {["How's my portfolio today?","What do I need to do today?","Summarize my emails","What's moving in semis?"].map(p=>(
                    <button key={p} onClick={()=>setChatIn(p)} style={{ background:"rgba(0,150,210,0.1)", border:"1px solid rgba(0,150,210,0.2)", borderRadius:6, color:"#4090c0", padding:"4px 10px", cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>{p}</button>
                  ))}
                </div>
              )}
              <div style={{ padding:"10px 14px", borderTop:"1px solid #1a2e3a", display:"flex", gap:8, flexShrink:0 }}>
                <input value={chatIn} onChange={e=>setChatIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendMsg()} placeholder="Ask Jarvis anything... (Enter)" disabled={chatBusy} style={{ flex:1, background:"#111", border:"1px solid #1a3040", borderRadius:8, padding:"9px 12px", color:"#cce0f5", fontSize:12, outline:"none", fontFamily:"inherit", opacity:chatBusy?0.6:1 }}/>
                <button onClick={sendMsg} disabled={chatBusy} style={{ background:"rgba(0,150,210,0.18)", border:"1px solid rgba(0,150,210,0.35)", borderRadius:8, color:"#00d4ff", padding:"9px 14px", cursor:"pointer", fontSize:15, opacity:chatBusy?0.5:1 }}>➤</button>
              </div>
            </>
          )}

          {panel==="briefing"&&(
            <div style={{ flex:1, overflowY:"auto", padding:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <span style={{ fontSize:10, color:"#1a3040", letterSpacing:"1px" }}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</span>
                <button onClick={genBrief} disabled={briefBusy} style={{ background:"rgba(0,150,210,0.1)", border:"1px solid rgba(0,150,210,0.25)", borderRadius:6, color:"#00d4ff", padding:"4px 12px", cursor:"pointer", fontSize:10, opacity:briefBusy?0.5:1 }}>
                  {briefBusy?"Generating...":"↺ New Briefing"}
                </button>
              </div>
              {briefBusy&&<div style={C.dim}>Jarvis is preparing your briefing...</div>}
              {brief&&<div style={{ fontSize:13, lineHeight:"1.9", color:"#80a8c8", whiteSpace:"pre-wrap" }}>{brief}</div>}
              {!brief&&!briefBusy&&<div style={C.dim}>Tap "New Briefing" to generate your morning briefing</div>}
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

          {/* Portfolio */}
          <div style={C.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={C.label}>📈 Portfolio · 1D</span>
              <Spin onClick={fetchStocks} spinning={spin.s}/>
            </div>
            {GROUPS.map(g=>(
              <div key={g.label} style={{ marginBottom:10 }}>
                <div style={{ fontSize:8, color:"#1a3040", letterSpacing:"1.5px", textTransform:"uppercase", marginBottom:4, paddingBottom:3, borderBottom:"1px solid #0d1820" }}>{g.label}</div>
                {g.tickers.map(ticker=>{
                  const s=stocks[ticker];
                  const pos=s?Number(s.pct)>=0:null;
                  const col=pos===null?"#253545":pos?C.pos:C.neg;
                  return(
                    <div key={ticker} style={{ display:"grid", gridTemplateColumns:"auto 1fr auto", alignItems:"center", gap:6, padding:"4px 0", borderBottom:"1px solid #080e16" }}>
                      <span style={{ fontFamily:"monospace", fontWeight:700, fontSize:11, color:"#d0e8ff" }}>{ticker}</span>
                      {s?(
                        <div style={{ width:"100%", height:3, background:"#0d1a22", borderRadius:2, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${Math.min(Math.abs(Number(s.pct))*10,100)}%`, background:col, borderRadius:2 }}/>
                        </div>
                      ):<div/>}
                      <div style={{ textAlign:"right" }}>
                        {s?(
                          <>
                            <div style={{ fontFamily:"monospace", fontSize:9, color:"#406080" }}>${Number(s.price).toFixed(2)}</div>
                            <div style={{ fontFamily:"monospace", fontSize:10, fontWeight:700, color:col }}>{pos?"+":""}{Number(s.pct).toFixed(2)}%</div>
                          </>
                        ):<span style={{ fontSize:10, color:"#1a3040" }}>—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {spin.s&&!Object.keys(stocks).length&&<div style={C.dim}>Fetching prices...</div>}
          </div>

          {/* Calendar */}
          <div style={C.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={C.label}>📅 Calendar</span>
              <Spin onClick={fetchCalendar} spinning={spin.c}/>
            </div>
            {Array.isArray(calendar)?calendar.length>0?calendar.map((e,i)=>(
              <div key={i} style={{ padding:"5px 0", borderBottom:i<calendar.length-1?"1px solid #0d1820":"none" }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#a0c0e0", lineHeight:"1.35" }}>{e.title}</div>
                <div style={{ fontSize:9, color:"#00a8cc", marginTop:2 }}>{e.date}{e.time?` · ${e.time}`:""}</div>
              </div>
            )):<div style={C.dim}>No upcoming events</div>
            :<div style={C.dim}>{spin.c?"Loading...":"—"}</div>}
          </div>

          {/* Drive Notes */}
          <div style={{ ...C.card, flex:1 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={C.label}>📝 Drive Notes</span>
              <Spin onClick={fetchDrive} spinning={spin.d}/>
            </div>
            {Array.isArray(driveNotes)?driveNotes.length>0?driveNotes.map((n,i)=>(
              <div key={i} style={{ marginBottom:10 }}>
                <div style={{ fontSize:9, fontWeight:700, color:"#00a8cc", letterSpacing:"1px", textTransform:"uppercase", marginBottom:4 }}>{n.title}</div>
                {(n.bullets||[]).map((b,j)=>(
                  <div key={j} style={{ fontSize:10, color:"#2a4858", padding:"2px 0 2px 8px", borderLeft:"2px solid #0d2030", marginBottom:3, lineHeight:"1.4" }}>{b}</div>
                ))}
              </div>
            )):<div style={C.dim}>No notes found — create a "Jarvis Notes" doc in Drive</div>
            :<div style={C.dim}>{spin.d?"Scanning Drive...":"—"}</div>}
          </div>
        </div>
      </div>

      {/* ── NEWS */}
      <div style={C.card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <span style={C.label}>📰 Market News</span>
          <Spin onClick={fetchNews} spinning={spin.n}/>
        </div>
        {Array.isArray(news)?(
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {news.map((n,i)=>(
              <div key={i} style={{ background:"#0a0a0a", border:"1px solid #141e28", borderRadius:8, padding:"10px 12px" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#fff", lineHeight:"1.4", marginBottom:4 }}>{n.headline}</div>
                <div style={{ fontSize:9, color:"#1a3048", fontWeight:700, letterSpacing:"0.5px", textTransform:"uppercase", marginBottom:4 }}>{n.source}</div>
                {n.blurb&&<div style={{ fontSize:10, color:"#3a5870", lineHeight:"1.4" }}>{n.blurb}</div>}
              </div>
            ))}
          </div>
        ):<div style={C.dim}>{spin.n?"Searching headlines...":"—"}</div>}
      </div>
    </div>
  );
}
