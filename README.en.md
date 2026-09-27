# cherina-pod

[![CI](https://github.com/realchendahuang/cherina-pod/actions/workflows/ci.yml/badge.svg)](https://github.com/realchendahuang/cherina-pod/actions/workflows/ci.yml) [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

> English · [中文](README.md)

**A self-hosted base for multilingual listening practice.**

Feed it any podcast RSS in any language; get back a word-level-timestamped transcript and a line-by-line bilingual rendering (`bilingual.json`) — produced on your own machine, deployed to your own Cloudflare account. Nothing about your content is held on anyone's server.

It can be a CLI pipeline, an agent skill, or a website you deploy yourself. The core isn't any of those forms — it's **the plain-JSON data and the engine that produces it**.

---

## The contract

Four promises to anyone who uses this:

1. **No sign-up** — the core (fetch, transcribe, translate, train) never puts an account wall in front of you.
2. **Data is files** — the only data format is plain JSON (`transcript.json` / `translation.json` / `bilingual.json`). No proprietary format, no database lock-in: `cp` your directory and you have a complete backup that any other tool can read.
3. **Processed locally** — transcription and translation run on your machine (or on a Worker you deploy). This project hosts, caches, and resells nothing.
4. **Language-agnostic** — the language pair is configuration, not an assumption baked into the code. `--source-lang` / `--target-lang` run through the whole chain (translation prompt, JSON keys, D1 columns are all `source` / `target`); switching language pairs changes no data structure. *Transcription defaults to Paraformer, but `transcript.json` is the interface — any ASR can replace it (see below).*

**Extension points** (the seams the paid tier will plug into — you can rely on these now):

| Seam | Today | Contract |
|---|---|---|
| Sync | none | Learning data (vocabulary / SRS progress / highlights) gets a cross-device sync interface; **transcripts stay local by default** |
| Identity | no accounts | Any account-requiring scenario (multi-device, institutions) uses a separate auth layer that never touches local processing |

## What it is / what it isn't

**Is**: a local pipeline + a plain-JSON data contract + a self-deployable Cloudflare front end + an agent skill.

**Is not**: an audio distributor, a content library, a "translation app".

**Copyright rules (red lines)**:

1. **Never touch the audio** — no caching, no proxying, no downloading. Play from the publisher's own URL.
2. **Never a central content library** — don't persist or share anyone's transcripts or translations.
3. **No third-party content in this repo** — full transcripts and translations of other people's podcasts don't belong in a public repository (samples must be self-recorded or public domain).

## Three forms

| Form | What it is | Who it's for |
|---|---|---|
| **Pipeline** (`scripts/`) | The engine: fetch → transcribe → translate → align | People who want to build their own |
| **Agent skill** (`skills/cherina-pod/`) | The pipeline packaged for agents | Agent users, batch processing |
| **Live instance** ([pod.cherina.app](https://pod.cherina.app)) | One deployment the maintainer runs | People who'd rather not set it up |

## Quick start

### 1. Setup

```bash
git clone <this-repo> && cd cherina-pod
cp .env.example .env        # fill in your keys
python3 -m pip install -r requirements.txt   # optional: only for the traditional→simplified step
```

Keys in `.env` (local only, never commit):

| Variable | Purpose |
|---|---|
| `DASHSCOPE_API_KEY` | Alibaba Cloud Bailian Paraformer ASR (word-level timestamps) |
| `OLLAMA_API_KEY` / `OPENCODE_API_KEY` | Translation (OpenAI-compatible endpoints, round-robin; either one works) |
| `RUSTFS_*` | Optional self-hosted audio source; leave empty to stream from the publisher's RSS |

Requirements: Python ≥ 3.9, ffmpeg / ffprobe, Node ≥ 20.

> **Not on a Chinese cloud account?** ASR currently requires DashScope. A local Whisper path is on the backlog — see below.

### 2. Process an episode

```bash
python3 scripts/fetch_podcast.py --search "Hidden Brain"
python3 scripts/run_pipeline.py --fetch <rss_url> --index 3

# pick a different language pair (default: auto → zh)
python3 scripts/run_pipeline.py --fetch <rss_url> --index 3 --source-lang zh --target-lang en
```

Output lands in `episodes/<id>/`: `transcript.json` (word-level timestamps) → `translation.json` (raw LLM output, gitignored) → `bilingual.json` (the aligned artifact).

Batch: put `<feedUrl> <index>` lines in `scripts/batch_jobs.txt`, then `bash scripts/batch_add.sh`.

### 3. Deploy to your own Cloudflare

```bash
cd web
npm install
npx wrangler d1 create cherina-pod-db      # put the returned id into wrangler.toml
python3 ../scripts/migrate_to_d1.py        # scan local episodes/ → web/migrations/*.sql
cat migrations/*.sql > migrations/_all.sql
npx wrangler d1 execute cherina-pod-db --remote --file=migrations/_all.sql

SITE_URL=https://my-pod.pages.dev \
SITE_NAME="My Pod" \
AUDIO_CDN="" \
  npm run build

npx wrangler deploy
```

Leaving `AUDIO_CDN` empty makes the player stream from the publisher's RSS — everything works, you just lose the guarantee that audio and transcript come from the identical file (podcast hosts insert dynamic ads, which shifts the timeline).

## Forking: six edits

| # | File | What to change |
|---|---|---|
| 1 | `web/wrangler.toml` | Your own `database_id`; the `routes` block is commented out by default (`*.workers.dev` works as-is) |
| 2 | `web/public/index.html` | The five `pod.cherina.app` occurrences flagged in the comment at the top of `<head>` |
| 3 | `web/build.mjs` | Default site name and description (or override via `SITE_NAME` / `SITE_DESC`) |
| 4 | `web/src/app.ts` | Nothing — all site config is injected at build time |
| 5 | `.env` | Your own ASR / translation keys; leave the self-hosted audio block empty |
| 6 | `episodes/` | Episodes you processed yourself (**don't commit other people's transcripts or translations**) |

## Data contract

`bilingual.json` — the only artifact downstream consumers need:

```json
{
  "id": "how-feelings-make-us-smarter",
  "source_lang": "en",
  "target_lang": "zh",
  "podcast": { "title": "Hidden Brain", "title_target": "隐藏的大脑", "author": "..." },
  "episode": { "title": "...", "title_target": "...", "description": "..." },
  "duration": 1234.5,
  "pairs": [
    { "source": "This is Hidden Brain.", "target": "这里是《隐藏的大脑》。", "start": 0.0, "end": 1.601 }
  ],
  "generated_at": "2026-08-23T10:00:00Z"
}
```

Field names are language-neutral: `source` / `target` are the original and its translation, `*_lang` records the language pair (BCP-47). Switch pairs and not one character of the structure changes. Files in the old format (`en` / `zh` / `title_zh`) are still read, so **you never have to re-run existing data**.

## Bring your own ASR

`transcript.json` is the **only interface** between transcription and the rest of the pipeline — translation, alignment and the D1 load all read its shape and never care who produced it. So swapping ASR means changing nothing downstream, as long as you output this shape:

```json
{
  "duration": 21.0,
  "sentences": [ { "text": "one sentence", "start": 0.0, "end": 1.6 } ],
  "words":     [ { "word": "word ", "start": 0.0, "end": 0.28 } ]
}
```

- `sentences` is required (alignment is built on it); `words` is word-level timing (finer positioning and shadowing — keep it)
- Anything that emits this structure works: `mlx-whisper`, `faster-whisper`, `whisper.cpp`, any cloud ASR
- After swapping: `python3 scripts/align.py <episode_dir>` (reuse existing translations) or `python3 scripts/translate.py <episode_dir> --target-lang <lang>` (retranslate too)

The bundled `transcribe.py` uses Alibaba Cloud Paraformer (`DASHSCOPE_API_KEY`), which is equally available on the international console.

## Roadmap gaps

- One-click "Deploy to Cloudflare" button
- Tests and CI
- More `podcast_meta.json` category / level tagging

## License

AGPL-3.0 — see [LICENSE](LICENSE). Your fork must stay open source; that's the AGPL's requirement, and the reason this project chose it.
