# ViggySounds - Artist EPK (React)

Single-page Linktree-style EPK for upcoming shows, past shows, music links, media, and YouTube.

## Local dev

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The production build output goes to `dist/`.

## Customize your content

Edit `src/data/epk.js`:

- `artistName`, `artistTagline`
- `hero.backgroundImage`
- `upcomingShows` (use `date` as `YYYY-MM-DD` + `href` to your ticket/RSVP link)
- `pastShows`
- `youtubeVideos` (`videoId` only)
- `socials`
- `contact.email`

## Media — show photos (automatic)

Add image files to `public/media/photos/shows/` (`.jpg`, `.png`, `.webp`, etc.). On `npm run dev` or `npm run build`, a small Vite plugin scans that folder and writes `src/generated/showPhotos.json`. The **Media** section reads that list—no manual entries in `epk.js`.

## Customize music (YAML)

Music is stored as YAML and loaded into the site.

- Originals: `src/data/music/originals.yaml`
- Remixes: `src/data/music/remixes.yaml`

Each YAML file has:

- `category`: `original` or `remix`
- `tracks`: an array of tracks with optional `url`, `spotify`, `soundcloud`, and `description`
- `coverArt`: (optional) string path to a local image, e.g. `media/cover-art/my-track.jpg`

## Deploy to GitHub Pages (via Workflow)

There is a GitHub Actions workflow in `.github/workflows/deploy.yml`.

It builds the app and deploys `dist/` to GitHub Pages.

After you push this folder to a GitHub repo, enable GitHub Pages in the repo settings and let the workflow run.

