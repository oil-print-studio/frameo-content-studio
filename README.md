# FRAME O Content Studio

A web app for FRAME O operators to make Instagram promo content quickly. It's an internal tool.

**V1, step 1: Instagram feed post maker**

1. Upload the original photo and a photo of the finished FRAME O piece
2. Enter the promo topic (required), plus product type, price and a short story (optional)
3. Click **인스타 게시물 만들기** ("Make Instagram post")
   - **A. Promo image**: a 1080×1350 (4:5) Before/After design, downloadable as a PNG
   - **B. Caption**: hook, short piece description, order CTA, frameoart.com and hashtags. Editable, with copy buttons for the body and the hashtags

![결과 화면](docs/screenshots/desktop-result.png)

## Running it

```bash
pnpm install
cp .env.example .env.local   # optional: without an API key it runs on mock output
pnpm dev                     # http://localhost:3000
```

To test on a phone, open `http://<PC IP>:3000` on the same Wi-Fi.
(Copy still works over http because it falls back to `execCommand`.)

| Command | Purpose |
| --- | --- |
| `pnpm check` | Type check + ESLint + unit tests (vitest) |
| `pnpm build` | Production build |
| `pnpm start` | Serve the build |

## AI caption generation

`lib/ai/` wraps the provider behind a `CaptionProvider` interface.

| Env var | Description |
| --- | --- |
| `AI_PROVIDER` | `auto` (default) / `anthropic` / `mock` |
| `ANTHROPIC_API_KEY` | With a key the Claude API is used; without one, mock templates |
| `ANTHROPIC_MODEL` | Default `claude-opus-5` |

- If the real API call fails, the route switches to the mock result automatically and shows a notice on screen, so work never stops.
- Adding a provider: implement `CaptionProvider` in `lib/ai/providers/`, then add a branch in `lib/ai/index.ts`.

## Structure

```
app/
  page.tsx                 # post maker screen
  api/caption/route.ts     # caption generation API (input validation → provider → mock fallback on failure)
components/
  PhotoUpload.tsx          # upload + preview (select, drag and drop)
  PostForm.tsx             # topic and optional inputs
  PromoPoster.tsx          # 1080×1350 Before/After design (HTML/CSS)
  PosterPreview.tsx        # scaled preview + PNG download
  CaptionResult.tsx        # caption editing and copy
lib/
  brand.ts                 # brand name, slogan, domain
  image.ts                 # client-side image resizing (long edge 2000px, EXIF rotation applied)
  exportPng.ts             # html-to-image → PNG
  clipboard.ts
  ai/                      # types, schema, prompt, provider selection, providers/{anthropic,mock}
tests/                     # vitest
```

## Out of scope for now

Automatic posting via the Instagram API, Reels, login/payments, admin features, and any connection to the order site.
