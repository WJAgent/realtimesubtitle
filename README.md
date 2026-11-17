# Wedding live captions (English ⇄ 中文)

Someone speaks English or Chinese. The big screen shows what they said **and** the translation:
English is always the top line, Chinese always the bottom line, so each half of the room knows where to look.

It is a static web page. There is no server, no build step, and it costs nothing.

```
mic → Chrome speech recognition → translation → display window (projector)
        (free, needs internet)     (see below)
```

## Run it

You need **Google Chrome on a laptop** (Safari and Firefox don't support the speech API well).

```bash
git clone https://github.com/jingx034/realtimesubtitle.git
cd realtimesubtitle
python3 -m http.server 8000
```

Open <http://localhost:8000>. (Opening `index.html` by double-click will not work: the microphone needs `http://localhost` or `https`.)

### Or host it free on GitHub Pages
Repo → **Settings → Pages → Deploy from a branch → `main` / root**. After a minute the app is live at
`https://jingx034.github.io/realtimesubtitle/`. That is the easiest way to use it on the wedding day.

## Using it

1. Open the operator console (`index.html`) and click **Open display window**. Drag that window to the projector and press **F** (or double-click) for fullscreen.
2. Click **Start listening** and allow the microphone.
3. Tell it who is speaking: **English** or **中文** (keys **E** / **C**). Speech recognition listens in one language at a time, so a helper at the laptop switches when the speaker changes.
4. Fix mistakes with **Type a line** or the **Edit** button in the transcript. Use **Quick phrases** for lines you want shown perfectly.
5. **Download transcript** at the end for a keepsake.

## Translation options (Settings)

| Option | Cost | Notes |
| --- | --- | --- |
| On-device (Chrome) | free | Chrome's built-in Translator API. Works offline, no limits. Needs a recent desktop Chrome. Chrome may download language models the first time you press Start, so do that at home. |
| Gemini API | free tier | Best quality, understands the glossary. Get a key at <https://aistudio.google.com/apikey> and paste it in Settings. Needs internet and has rate limits. |
| MyMemory | free | No key. Basic quality and a small daily limit. Used as a last fallback. |

If the chosen option fails, the app tries the others automatically. Phrases in `src/phrasebook.js` always win and need no translation at all.

The API key is stored only in your browser (localStorage). It is never written to the repo.

## Make it yours (good first tasks for two people)

- `src/phrasebook.js`: add vows, toasts, MC lines and names. This is the biggest quality win. Collect speeches ahead of time.
- `src/config.js`: change the welcome text shown before anyone speaks.
- `src/display.css`: colours, fonts, spacing for the big screen.

## Files

```
index.html          operator console
display.html        the big screen
src/app.js          console logic: listening, translating, publishing
src/speech.js       Web Speech API wrapper (auto-restarts when Chrome stops it)
src/translate.js    translation providers + fallback + cache
src/phrasebook.js   exact phrases and glossary
src/display.js      renders what the console sends (BroadcastChannel)
src/*.css           styling
```

## Known limits

- Speech recognition needs internet (Chrome sends audio to Google) and one language at a time.
- A sentence that mixes English and Chinese will be recognised poorly.
- Chinese output is Simplified.
- A good microphone close to the speaker matters more than any code. Test at the venue.

## Wedding-day checklist

- [ ] Full rehearsal with the real mic, PA and projector at least a week before
- [ ] Wired internet or a phone hotspot as backup
- [ ] Press Start once at home so Chrome has downloaded its translation models
- [ ] Phrasebook filled with vows, toasts and names
- [ ] A bilingual friend ready to use **Type a line** if recognition fails
- [ ] Laptop plugged in; sleep and notifications turned off

## Working together

Make a branch per change (`git switch -c phrasebook-toasts`), commit, push, and merge on GitHub.
Never commit API keys.
