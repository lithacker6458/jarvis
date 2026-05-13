# JARVIS SETUP — Anish Kumar Boddu
> Local-first spoken AI briefing + visual Claude dashboard + clap trigger

---

## What You're Building

| Layer | Tool | What It Does |
|---|---|---|
| 🔊 **Voice Jarvis** | OpenJarvis | Spoken morning briefing — calendar, email, market news. British voice. Runs locally. |
| 📊 **Visual Jarvis** | Claude Dashboard | Portfolio prices, weather, to-do, news grid, exam countdown |
| 👏 **Clap Trigger** | clap-trigger.html | Pinned browser tab — two claps → Jarvis opens |

---

## PART 1 — Install OpenJarvis (Voice Briefing)

### Step 1 · Install

**Mac / Linux / WSL2 on Windows:**
```bash
curl -fsSL https://openjarvis.ai/install.sh | bash
```
Takes ~3 minutes. Installs: Python env (uv), Ollama, a starter LLM. Then:
```bash
source ~/.openjarvis/env/bin/activate   # or: jarvis (if installer added to PATH)
jarvis doctor                            # check everything installed
```

**Pull the recommended model:**
```bash
ollama pull qwen3.5:9b       # ~6GB, best quality
# If your laptop is older/slower:
ollama pull qwen3.5:4b       # ~2.5GB, faster
```

---

### Step 2 · Copy Config Files

Place the files from this folder:

```bash
# Create config directory
mkdir -p ~/.openjarvis/connectors
mkdir -p ~/.openjarvis/prompts/personas

# Copy main config
cp config.toml ~/.openjarvis/config.toml

# Copy your custom Jarvis persona
cp jarvis_anish.md ~/.openjarvis/prompts/personas/jarvis_anish.md

# Copy finance RSS feeds
cp news_rss.json ~/.openjarvis/connectors/news_rss.json
```

---

### Step 3 · Connect Google Account

One OAuth flow covers Gmail + Calendar + Drive:
```bash
jarvis connect gdrive
```
Opens browser → sign in → done. All three connectors activate.

---

### Step 4 · Get Your Voice Key (Cartesia)

The authentic British Jarvis voice (Alistair) is from Cartesia:
1. Go to **https://play.cartesia.ai** → sign up free
2. Get your API key from the dashboard
3. Add to OpenJarvis:
```bash
jarvis config set tts.cartesia_api_key YOUR_KEY_HERE
```

**Alternative:** Use OpenAI TTS instead (edit `config.toml`, change `tts_backend = "openai"` and set your OpenAI key):
```bash
jarvis config set tts.openai_api_key YOUR_OPENAI_KEY
```

---

### Step 5 · Run Your First Briefing

```bash
jarvis digest --fresh
```

Jarvis speaks. He'll tell you your calendar, urgent emails, and market headlines. British accent. Dry wit. Your name.

**Text-only mode (no voice):**
```bash
jarvis digest --fresh --text-only
```

---

### Step 6 · Automate at 7 AM (Optional)

The `config.toml` already has `schedule = "0 7 * * 1-5"` (weekdays 7 AM Central).

**Mac** — run as a background service:
```bash
jarvis daemon start
```

**Linux / WSL2:**
```bash
# Add to crontab
crontab -e
# Add this line:
0 7 * * 1-5 /path/to/jarvis digest --fresh
```

---

## PART 2 — Clap Trigger

**File:** `clap-trigger.html`

### Setup
1. Open `clap-trigger.html` in Chrome
2. Click **"ACTIVATE MIC"** — allow microphone
3. In Chrome: right-click the tab → **"Pin tab"** (keeps it tiny and always open)
4. **Edit line 10** of the HTML — replace `YOUR_PROJECT_ID_HERE` with your Claude Jarvis project ID:
   - Open Claude → your Jarvis project → copy the ID from the URL
   - URL looks like: `https://claude.ai/project/abc123xyz`
   - Paste `abc123xyz` where it says `YOUR_PROJECT_ID_HERE`

### How It Works
- Pinned tab listens via mic 24/7
- **Two claps within 1.2 seconds** → Claude Jarvis opens in a new tab
- Visualizer shows mic input in real time
- Adjust `CLAP_THRESHOLD` in the HTML if it's too sensitive or not sensitive enough (default: 0.25)

### Keyboard Shortcut (Mac Alternative)

macOS Shortcuts app → New Shortcut:
- Add action: **"Open URLs"** → paste your Claude Jarvis project URL
- Click the shortcut → Settings → Add Keyboard Shortcut: `⌘⌥J`
- Say **"Hey Siri, open Jarvis"** (Siri phrase option)

**Windows AutoHotkey alternative:**
```ahk
; Save as jarvis.ahk, run on startup
^!j::Run "https://claude.ai/project/YOUR_PROJECT_ID"
```
That's `Ctrl+Alt+J` → opens Jarvis.

---

## PART 3 — Visual Dashboard (Claude)

This is already built — the `jarvis-dashboard.jsx` file.

### GitHub Auto-Sync Setup
1. Create repo at github.com → name it `jarvis`
2. Upload `jarvis-dashboard.jsx`
3. Get the raw URL: `https://raw.githubusercontent.com/YOUR_USERNAME/jarvis/main/jarvis-dashboard.jsx`
4. In your Claude **Jarvis Project** instructions, paste:
   > When I say "hey jarvis", fetch the latest code from `https://raw.githubusercontent.com/YOUR_USERNAME/jarvis/main/jarvis-dashboard.jsx` using your web fetch tool, then immediately render it as a React artifact. Just render it, no explanation.

Future updates: edit on GitHub → changes auto-pull next time you say "hey jarvis".

---

## PART 4 — The Full Daily Flow

| Time | What Happens |
|---|---|
| **7:00 AM** | OpenJarvis speaks automatically — calendar, emails, market headlines |
| **Open laptop** | Double-clap → Claude visual dashboard opens |
| **Any time** | Say "hey jarvis" in Claude project → full dashboard refreshes |
| **Market hours** | Dashboard portfolio updates on demand via ↺ button |

---

## Troubleshooting

**Jarvis isn't speaking:**
```bash
jarvis doctor                    # shows what's connected
jarvis digest --fresh --text-only  # test without TTS first
```

**Calendar not showing:**
```bash
jarvis connect gdrive            # re-auth Google
```

**Clap trigger too sensitive / not sensitive:**
Edit `clap-trigger.html` line: `const CLAP_THRESHOLD = 0.25;`
- Higher (e.g. 0.4) = needs louder clap
- Lower (e.g. 0.15) = triggers easier

**Model too slow:**
Edit `config.toml` → change `default_model = "qwen3.5:4b"`

---

## Files in This Folder

```
config.toml          → goes to ~/.openjarvis/config.toml
jarvis_anish.md      → goes to ~/.openjarvis/prompts/personas/
news_rss.json        → goes to ~/.openjarvis/connectors/
clap-trigger.html    → open in Chrome, pin the tab
JARVIS_SETUP.md      → this file
```

---

*"The goal of AI is to do cool shit and larp." — Anish, 2026*
