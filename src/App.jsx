import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaPlay, FaLink } from "react-icons/fa";
import {
  SiBeatport,
  SiInstagram,
  SiSoundcloud,
  SiSpotify,
  SiTiktok,
  SiYoutube,
} from "react-icons/si";
import { EPK } from "./data/epk.js";
import showPhotos from "./generated/showPhotos.json";
import yaml from "js-yaml";
import originalsYamlRaw from "./data/music/originals.yaml?raw";
import remixesYamlRaw from "./data/music/remixes.yaml?raw";

/** Same-origin `/api` in dev (Vite proxy); full URL when `VITE_API_BASE_URL` is set. */
function apiRelativeUrl(path) {
  const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

/**
 * Epoch ms for sorting show lists. Supports YYYY-MM-DD and common display strings
 * in `date` (e.g. "April 16th, 2026", "July 10-11, 2026" uses the first day).
 * @returns {number} NaN if unparseable
 */
function parseShowDateForSort(dateStr) {
  if (dateStr == null || String(dateStr).trim() === "") return NaN;
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = new Date(`${s}T12:00:00`).getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  // "July 10-11, 2026" — must run before Date.parse (which can mis-parse the range)
  const monthDayRange = s.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*\d{1,2},?\s*(\d{4})\s*$/,
  );
  if (monthDayRange) {
    const tryStr = `${monthDayRange[1]} ${monthDayRange[2]}, ${monthDayRange[3]}`;
    const ms = Date.parse(tryStr);
    if (!Number.isNaN(ms)) return ms;
  }
  const deOrdinal = s.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  let ms = Date.parse(deOrdinal);
  if (!Number.isNaN(ms)) return ms;
  ms = Date.parse(s);
  return Number.isNaN(ms) ? NaN : ms;
}

/**
 * Local midnight on the last calendar day of the event (for past vs upcoming).
 * @returns {Date | null}
 */
function parseShowLastLocalDay(dateStr) {
  if (dateStr == null || String(dateStr).trim() === "") return null;
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const monthDayRange = s.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s*(\d{4})\s*$/,
  );
  if (monthDayRange) {
    const month = monthDayRange[1];
    const endDay = parseInt(monthDayRange[3], 10);
    const year = parseInt(monthDayRange[4], 10);
    const ms = Date.parse(`${month} ${endDay}, ${year}`);
    if (Number.isNaN(ms)) return null;
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const ms = parseShowDateForSort(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isShowPast(dateStr, now = new Date()) {
  const lastDay = parseShowLastLocalDay(dateStr);
  if (!lastDay) return false;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return todayStart > lastDay;
}

function formatDate(dateStr) {
  const s = String(dateStr ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const dt = new Date(`${s}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return dateStr;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(dt);
  }
  // Keep multi-day labels as authored (e.g. "July 10-11, 2026")
  if (/^[A-Za-z]+\s+\d{1,2}\s*-\s*\d{1,2},?\s*\d{4}\s*$/.test(s)) {
    return s;
  }
  const ms = parseShowDateForSort(s);
  if (!Number.isNaN(ms)) {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(ms));
  }
  return s || dateStr;
}

function youtubeThumb(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function hexToRgba(hex, alpha) {
  // Supports #RGB and #RRGGBB
  const clean = String(hex || "")
    .trim()
    .replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0").slice(0, 6);
  const num = parseInt(full, 16);
  // eslint-disable-next-line no-bitwise
  const r = (num >> 16) & 255;
  // eslint-disable-next-line no-bitwise
  const g = (num >> 8) & 255;
  // eslint-disable-next-line no-bitwise
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseMusicYaml(raw, fallbackCategory) {
  try {
    const data = yaml.load(raw);
    const category = data?.category || fallbackCategory || "unknown";
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    return tracks.map((t) => ({
      ...t,
      type: t?.type || category,
    }));
  } catch (e) {
    console.error("Failed to parse music YAML:", e);
    return [];
  }
}

/** `releaseDate` from YAML as YYYY-MM-DD */
function parseTrackReleaseDate(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  const dt = new Date(`${s}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

function soundcloudPlayerSrc(trackUrl) {
  const q = new URLSearchParams({
    url: trackUrl,
    color: "#ff5500",
    auto_play: "false",
    hide_related: "true",
    show_comments: "true",
    show_playcount: "true",
    show_user: "true",
    show_teaser: "true",
    visual: "true",
  });
  return `https://w.soundcloud.com/player/?${q.toString()}`;
}

function formatPlayCount(n) {
  if (n == null || typeof n !== "number" || Number.isNaN(n)) return null;
  return new Intl.NumberFormat(undefined).format(n);
}

/** SoundCloud API date string (release YYYY-MM-DD or created_at) → short display */
function formatSoundcloudDate(iso) {
  if (iso == null || typeof iso !== "string") return null;
  const s = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  }
  const d = new Date(s.includes("/") ? s.replace(/\//g, "-") : s);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** True if YAML has a valid http(s) URL (excludes placeholders like "NA"). */
function isValidStreamingUrl(s) {
  if (s == null || typeof s !== "string") return false;
  const u = s.trim();
  if (!u || /^na$/i.test(u)) return false;
  return /^https?:\/\//i.test(u);
}

/** True when releaseDate is set and strictly after local today (not yet released). */
function isTrackReleaseUpcoming(t) {
  const d = parseTrackReleaseDate(t.releaseDate);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const release = new Date(d);
  release.setHours(0, 0, 0, 0);
  return release > today;
}

function MusicLinksRow({ track: t, className = "" }) {
  const upcoming = isTrackReleaseUpcoming(t);
  const presaveUrl =
    typeof t.presave === "string" && isValidStreamingUrl(t.presave)
      ? t.presave.trim()
      : null;
  const soundcloudUrl = isValidStreamingUrl(t.soundcloud)
    ? t.soundcloud.trim()
    : null;
  const beatportUrl = isValidStreamingUrl(t.beatport)
    ? t.beatport.trim()
    : null;
  const rowClass = ["musicLinksRow", className].filter(Boolean).join(" ");

  if (upcoming) {
    if (!presaveUrl && !soundcloudUrl && !beatportUrl) {
      return <div className={rowClass} />;
    }
    return (
      <div className={rowClass}>
        {presaveUrl ? (
          <a
            className="musicChip musicChipPresave musicChipCompactLabel"
            href={presaveUrl}
            target="_blank"
            rel="noreferrer"
          >
            Pre-save
          </a>
        ) : null}
        {soundcloudUrl ? (
          <a
            className="musicChip musicChipSoundcloud musicChipIconOnly"
            href={soundcloudUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Listen on SoundCloud"
          >
            <SiSoundcloud className="musicChipIcon" aria-hidden />
          </a>
        ) : null}
        {beatportUrl ? (
          <a
            className="musicChip musicChipBeatport musicChipIconOnly"
            href={beatportUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Buy on Beatport"
          >
            <SiBeatport className="musicChipIcon" aria-hidden />
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className={rowClass}>
      {t.url && isValidStreamingUrl(t.url) ? (
        <a
          className="musicChip musicChipIconOnly"
          href={t.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Listen"
        >
          <FaPlay className="musicChipIcon" aria-hidden />
        </a>
      ) : null}
      {isValidStreamingUrl(t.spotify) ? (
        <a
          className="musicChip musicChipSpotify musicChipIconOnly"
          href={t.spotify.trim()}
          target="_blank"
          rel="noreferrer"
          aria-label="Listen on Spotify"
        >
          <SiSpotify className="musicChipIcon" aria-hidden />
        </a>
      ) : null}
      {soundcloudUrl ? (
        <a
          className="musicChip musicChipSoundcloud musicChipIconOnly"
          href={soundcloudUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Listen on SoundCloud"
        >
          <SiSoundcloud className="musicChipIcon" aria-hidden />
        </a>
      ) : null}
      {beatportUrl ? (
        <a
          className="musicChip musicChipBeatport musicChipIconOnly"
          href={beatportUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Buy on Beatport"
        >
          <SiBeatport className="musicChipIcon" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

/** Horizontal SoundCloud player carousel (top plays / recent). */
function SoundcloudCarousel({
  items,
  status,
  listTab,
  onListTabChange,
  profileHref,
  prefersReducedMotion = false,
}) {
  const trackRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
    const el = trackRef.current;
    if (el) el.scrollTo({ left: 0, behavior: "auto" });
  }, [listTab, items]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onScroll = () => {
      const slides = el.querySelectorAll(".soundcloudCarouselSlide");
      if (!slides.length) return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      slides.forEach((slide, i) => {
        const center = slide.offsetLeft + slide.offsetWidth / 2;
        const d = Math.abs(center - mid);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActiveIndex(best);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [items]);

  const scrollToIndex = (index) => {
    const el = trackRef.current;
    if (!el) return;
    const slides = el.querySelectorAll(".soundcloudCarouselSlide");
    const slide = slides[index];
    if (!slide) return;
    slide.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
    setActiveIndex(index);
  };

  const go = (delta) => {
    if (!items.length) return;
    const next = Math.max(0, Math.min(items.length - 1, activeIndex + delta));
    scrollToIndex(next);
  };

  const metaLabel =
    listTab === "plays" ? "Top by plays" : "Most recent releases";

  return (
    <div className="soundcloudCarousel" aria-label="SoundCloud">
      <div className="soundcloudCarouselTop">
        <div className="soundcloudCarouselHeading">
          <h3 className="soundcloudCarouselTitle">
            <SiSoundcloud className="soundcloudCarouselTitleIcon" aria-hidden />
            SoundCloud
          </h3>
          <p className="soundcloudCarouselHint">{metaLabel}</p>
        </div>
        <div
          className="soundcloudCarouselModes"
          role="tablist"
          aria-label="SoundCloud lists"
        >
          <button
            type="button"
            role="tab"
            aria-selected={listTab === "plays"}
            className={`soundcloudCarouselMode${listTab === "plays" ? " soundcloudCarouselModeActive" : ""}`}
            onClick={() => onListTabChange("plays")}
          >
            Top plays
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={listTab === "recent"}
            className={`soundcloudCarouselMode${listTab === "recent" ? " soundcloudCarouselModeActive" : ""}`}
            onClick={() => onListTabChange("recent")}
          >
            Recent
          </button>
        </div>
      </div>

      {status === "loading" && items.length === 0 ? (
        <p className="soundcloudCarouselStatus" role="status">
          Loading SoundCloud…
        </p>
      ) : null}

      {status === "error" && items.length === 0 ? (
        <div className="soundcloudCarouselEmpty">
          <p className="soundcloudCarouselStatus">Could not load tracks.</p>
          <a
            className="pillBtn pillBtnSoundcloud"
            href={profileHref}
            target="_blank"
            rel="noreferrer"
          >
            <SiSoundcloud className="pillBtnIcon" aria-hidden />
            Open SoundCloud
          </a>
        </div>
      ) : null}

      {status !== "error" && status !== "loading" && items.length === 0 ? (
        <div className="soundcloudCarouselEmpty">
          <p className="soundcloudCarouselStatus">No tracks to show.</p>
          <a
            className="pillBtn pillBtnSoundcloud"
            href={profileHref}
            target="_blank"
            rel="noreferrer"
          >
            <SiSoundcloud className="pillBtnIcon" aria-hidden />
            Open SoundCloud
          </a>
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="soundcloudCarouselViewport">
            {items.length > 1 ? (
              <button
                type="button"
                className="soundcloudCarouselNav soundcloudCarouselNavPrev"
                onClick={() => go(-1)}
                disabled={activeIndex <= 0}
                aria-label="Previous track"
              >
                ‹
              </button>
            ) : null}
            <div
              className="soundcloudCarouselTrack"
              ref={trackRef}
              tabIndex={0}
              aria-label="SoundCloud tracks"
            >
              {items.map((item, i) => {
                const dateStr =
                  listTab === "recent"
                    ? formatSoundcloudDate(item.releaseDate || item.createdAt)
                    : null;
                const playsStr =
                  formatPlayCount(item.playbackCount) != null
                    ? `${formatPlayCount(item.playbackCount)} plays`
                    : null;
                const meta = [dateStr, playsStr].filter(Boolean).join(" · ");
                return (
                  <article
                    key={`${listTab}-${item.url}-${i}`}
                    className="soundcloudCarouselSlide"
                    aria-roledescription="slide"
                    aria-label={
                      item.title
                        ? `${item.title}${meta ? `, ${meta}` : ""}`
                        : `Track ${i + 1}`
                    }
                  >
                    {item.title || meta ? (
                      <div className="soundcloudCarouselSlideMeta">
                        {item.title ? (
                          <span className="soundcloudCarouselSlideTitle">
                            {item.title}
                          </span>
                        ) : null}
                        {meta ? (
                          <span className="soundcloudCarouselSlidePlays">
                            {meta}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <iframe
                      title={
                        item.title
                          ? `${item.title} (SoundCloud)`
                          : `SoundCloud ${i + 1}`
                      }
                      className="soundcloudEmbed"
                      width="100%"
                      height="166"
                      scrolling="no"
                      frameBorder="no"
                      allow="autoplay"
                      src={soundcloudPlayerSrc(item.url)}
                      loading={i === 0 ? "eager" : "lazy"}
                    />
                  </article>
                );
              })}
            </div>
            {items.length > 1 ? (
              <button
                type="button"
                className="soundcloudCarouselNav soundcloudCarouselNavNext"
                onClick={() => go(1)}
                disabled={activeIndex >= items.length - 1}
                aria-label="Next track"
              >
                ›
              </button>
            ) : null}
          </div>
          {items.length > 1 ? (
            <div
              className="soundcloudCarouselDots"
              role="tablist"
              aria-label="Track position"
            >
              {items.map((_, i) => (
                <button
                  key={`dot-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === activeIndex}
                  aria-label={`Go to track ${i + 1}`}
                  className={`soundcloudCarouselDot${i === activeIndex ? " soundcloudCarouselDotActive" : ""}`}
                  onClick={() => scrollToIndex(i)}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Spotify artist embed via GET /api/spotify/artist/tracks (catalog meta). */
function SpotifyArtistCatalog({ status, meta, nested = false }) {
  const HeadingTag = nested ? "h3" : "h2";

  if (status === "loading") {
    return (
      <div className="spotifyCatalog" aria-busy="true">
        <p className="spotifyCatalogHint" role="status">
          Loading Spotify…
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="spotifyCatalog">
        <p className="musicSpotifyError" role="alert">
          Could not load Spotify. Configure{" "}
          <code className="musicSpotifyCode">SPOTIFY_CLIENT_ID</code> /{" "}
          <code className="musicSpotifyCode">SPOTIFY_CLIENT_SECRET</code> and{" "}
          <code className="musicSpotifyCode">SPOTIFY_ARTIST_ID</code> in{" "}
          <code className="musicSpotifyCode">server/.env</code>, then restart
          the API.
        </p>
      </div>
    );
  }

  const artistId =
    typeof meta?.artistId === "string" && meta.artistId.trim()
      ? meta.artistId.trim()
      : null;
  const artistName =
    typeof meta?.artistName === "string" && meta.artistName.trim()
      ? meta.artistName.trim()
      : null;
  const artistImageUrl =
    typeof meta?.artistImageUrl === "string" && meta.artistImageUrl.trim()
      ? meta.artistImageUrl.trim()
      : null;
  const hint =
    typeof meta?.albumsScanned === "number" && meta.albumsScanned > 0
      ? `${meta.albumsScanned} release${meta.albumsScanned === 1 ? "" : "s"} on Spotify`
      : "Play and browse tracks in the Spotify player";

  if (!artistId) {
    return (
      <div className="spotifyCatalog" aria-label="Spotify artist">
        <div className="spotifyCatalogEmpty">
          <p className="muted">
            No artist id returned. Set{" "}
            <code className="musicSpotifyCode">SPOTIFY_ARTIST_ID</code> in{" "}
            <code className="musicSpotifyCode">server/.env</code> and restart
            the API.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="spotifyCatalog" aria-label="Spotify artist">
      <div className="spotifyCatalogTop">
        <HeadingTag
          className={`spotifyCatalogTitle${nested ? " spotifyCatalogTitleNested" : ""}`}
        >
          <SiSpotify className="heroPlaylistsTitleIcon" aria-hidden />
          {artistName ? (
            <p className="spotifyCatalogArtist">{artistName}</p>
          ) : null}
        </HeadingTag>
        <p className="spotifyCatalogHint">{hint}</p>
      </div>
      <div className="spotifyArtistEmbed">
        {/* {artistImageUrl ? (
          <img
            className="spotifyArtistImage"
            src={artistImageUrl}
            alt={artistName || "Artist"}
            loading="lazy"
          />
        ) : null} */}
        <div className="heroPlaylistEmbedFrame">
          <iframe
            title={`Spotify — ${artistName || "artist"}`}
            src={`https://open.spotify.com/embed/artist/${encodeURIComponent(artistId)}?utm_source=generator&theme=0`}
            loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    </div>
  );
}

function SocialsFixed({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const icons = {
    instagram: SiInstagram,
    soundcloud: SiSoundcloud,
    spotify: SiSpotify,
    beatport: SiBeatport,
    tiktok: SiTiktok,
    youtube: SiYoutube,
  };

  return (
    <div className="fixedSocials" aria-hidden={false}>
      {items.map((s) => {
        const key = String(s.label || "").toLowerCase();
        const Icon = icons[key] || FaLink;
        const href = typeof s.href === "string" ? s.href.trim() : "#";
        return (
          <a
            key={s.label}
            className="fixedSocial"
            href={href}
            target={s.external ? "_blank" : undefined}
            rel={s.external ? "noreferrer" : undefined}
            aria-label={s.label}
            style={
              s.brandColor
                ? {
                    background: hexToRgba(s.brandColor, 0.12),
                    color: s.brandColor,
                  }
                : undefined
            }
          >
            <Icon className="fixedSocialIcon" aria-hidden />
          </a>
        );
      })}
    </div>
  );
}

function FixedQuickActions({ items }) {
  const [activeHash, setActiveHash] = useState(
    () => window.location.hash || "",
  );

  useEffect(() => {
    const onHash = () => setActiveHash(window.location.hash || "");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <nav className="fixedQuickActions" aria-label="Quick actions">
      {items.map((a) => {
        const href = a.href || "#";
        const isActive =
          href === activeHash || (href === "#listen" && activeHash === "");
        return (
          <a
            key={a.label}
            href={href}
            className={`fixedQuickActionsBtn${isActive ? " fixedQuickActionsBtnActive" : ""}`}
          >
            {a.label}
          </a>
        );
      })}
    </nav>
  );
}

export default function App() {
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [photoSlideIndex, setPhotoSlideIndex] = useState(0);
  const [photoSlidePaused, setPhotoSlidePaused] = useState(false);
  const [musicFilter, setMusicFilter] = useState("original"); // original | remix
  /** Narrow viewports: compact music rows + photo slideshow (grid on wider screens) */
  const musicCompact = useMediaQuery("(max-width: 560px)");
  const prefersReducedMotion = useMediaQuery(
    "(prefers-reduced-motion: reduce)",
  );
  /** SoundCloud list mode: top by plays vs newest by public release date */
  const [soundcloudListTab, setSoundcloudListTab] = useState("plays");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactStatus, setContactStatus] = useState("idle"); // idle | sending | success | error
  const [contactErrorText, setContactErrorText] = useState("");
  const [backendOnline, setBackendOnline] = useState(true);

  async function pingBackend() {
    try {
      const url = apiRelativeUrl("/health");
      const r = await fetch(url, { cache: "no-store" });
      setBackendOnline(!!r && r.ok);
      return !!r && r.ok;
    } catch (e) {
      setBackendOnline(false);
      return false;
    }
  }

  function clearContactFeedback() {
    if (contactStatus === "success" || contactStatus === "error") {
      setContactStatus("idle");
      setContactErrorText("");
    }
  }

  async function handleContactSubmit(e) {
    e.preventDefault();
    setContactErrorText("");
    setContactStatus("sending");
    try {
      const res = await fetch(import.meta.env.VITE_CONTACT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: contactName.trim(),
          email: contactEmail.trim(),
          message: contactMessage.trim(),
        }),
      });
      const text = (await res.text()).trim();
      if (!res.ok) {
        throw new Error(text || `Request failed (${res.status})`);
      }
      if (text === "error") {
        throw new Error("Could not send — try again or email directly.");
      }
      setContactStatus("success");
      setContactName("");
      setContactEmail("");
      setContactMessage("");
    } catch (err) {
      setContactStatus("error");
      setContactErrorText(
        err instanceof Error ? err.message : "Something went wrong.",
      );
      setBackendOnline(false);
    }
  }

  useEffect(() => {
    if (!lightboxPhoto && !activeVideoId) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setLightboxPhoto(null);
        setActiveVideoId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxPhoto, activeVideoId]);

  const showPhotosList = showPhotos || [];
  const showPhotoCount = showPhotosList.length;

  useEffect(() => {
    setPhotoSlideIndex((i) =>
      showPhotoCount === 0 ? 0 : Math.min(i, showPhotoCount - 1),
    );
  }, [showPhotoCount]);

  useEffect(() => {
    if (
      !musicCompact ||
      showPhotoCount <= 1 ||
      photoSlidePaused ||
      prefersReducedMotion
    ) {
      return undefined;
    }
    const id = window.setInterval(() => {
      setPhotoSlideIndex((i) => (i + 1) % showPhotoCount);
    }, 5500);
    return () => window.clearInterval(id);
  }, [musicCompact, showPhotoCount, photoSlidePaused, prefersReducedMotion]);

  /** Bump when local calendar day changes so past/upcoming lists stay correct overnight. */
  const [showDayTick, setShowDayTick] = useState(0);
  useEffect(() => {
    let timeoutId;
    const scheduleNextMidnight = () => {
      const now = Date.now();
      const nextMidnight = new Date();
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      nextMidnight.setHours(0, 0, 0, 0);
      const delay = Math.max(nextMidnight.getTime() - now, 1000);
      timeoutId = window.setTimeout(() => {
        setShowDayTick((n) => n + 1);
        scheduleNextMidnight();
      }, delay);
    };
    scheduleNextMidnight();
    return () => clearTimeout(timeoutId);
  }, []);

  const allShows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const s of EPK.shows ?? []) {
      const k = `${s.date}\0${s.title}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }, []);

  /** Soonest first / most recent first, split by calendar day vs today */
  const { upcoming, past } = useMemo(() => {
    const now = new Date();
    const upcomingList = [];
    const pastList = [];
    for (const s of allShows) {
      if (isShowPast(s.date, now)) pastList.push(s);
      else upcomingList.push(s);
    }
    const sortAsc = (a, b) => {
      const ta = parseShowDateForSort(a.date);
      const tb = parseShowDateForSort(b.date);
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
      if (!Number.isNaN(ta)) return -1;
      if (!Number.isNaN(tb)) return 1;
      return String(a.date).localeCompare(String(b.date));
    };
    const sortDesc = (a, b) => {
      const ta = parseShowDateForSort(a.date);
      const tb = parseShowDateForSort(b.date);
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return tb - ta;
      if (!Number.isNaN(ta)) return -1;
      if (!Number.isNaN(tb)) return 1;
      return String(b.date).localeCompare(String(a.date));
    };
    upcomingList.sort(sortAsc);
    pastList.sort(sortDesc);
    return { upcoming: upcomingList, past: pastList };
  }, [allShows, showDayTick]);

  const activeVideo =
    activeVideoId && EPK.youtubeVideos.find((v) => v.videoId === activeVideoId);

  const [soundcloudPlays, setSoundcloudPlays] = useState({
    status: "loading",
    tracks: [],
  });
  const [soundcloudRecent, setSoundcloudRecent] = useState({
    status: "loading",
    tracks: [],
  });
  useEffect(() => {
    const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
    const playsUrl = base
      ? `${base}/api/soundcloud/top-tracks?limit=5`
      : "/api/soundcloud/top-tracks?limit=5";
    const recentUrl = base
      ? `${base}/api/soundcloud/recent-tracks?limit=5`
      : "/api/soundcloud/recent-tracks?limit=5";
    let cancelled = false;
    const load = (url, set) => {
      fetch(url, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          setBackendOnline(true);
          return r.json();
        })
        .then((data) => {
          if (cancelled) return;
          const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
          set({
            status: tracks.length > 0 ? "ok" : "empty",
            tracks,
          });
        })
        .catch(() => {
          if (!cancelled) {
            set({ status: "error", tracks: [] });
            setBackendOnline(false);
          }
        });
    };
    load(playsUrl, setSoundcloudPlays);
    load(recentUrl, setSoundcloudRecent);
    return () => {
      cancelled = true;
    };
  }, []);

  const [spotifyArtistCatalog, setSpotifyArtistCatalog] = useState({
    status: "loading",
    tracks: [],
    meta: null,
  });

  useEffect(() => {
    let cancelled = false;
    const url = `${apiRelativeUrl("/api/spotify/artist/tracks")}?limit=200`;
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        setBackendOnline(true);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!data?.ok) {
          setSpotifyArtistCatalog({
            status: "error",
            tracks: [],
            meta: data?.meta ?? null,
          });
          return;
        }
        const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
        const meta = data?.meta ?? null;
        const hasArtist =
          typeof meta?.artistId === "string" && meta.artistId.trim();
        setSpotifyArtistCatalog({
          status: hasArtist || tracks.length > 0 ? "ok" : "empty",
          tracks,
          meta,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSpotifyArtistCatalog({
            status: "error",
            tracks: [],
            meta: null,
          });
          setBackendOnline(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** API rows: playback_count and/or release_date */
  const soundcloudEmbedItems = useMemo(() => {
    const src =
      soundcloudListTab === "plays" ? soundcloudPlays : soundcloudRecent;
    if (src.status === "ok" && src.tracks.length > 0) {
      return src.tracks
        .map((t) => ({
          url: t.permalink_url,
          title: typeof t.title === "string" ? t.title : "",
          playbackCount:
            typeof t.playback_count === "number" ? t.playback_count : null,
          releaseDate:
            typeof t.release_date === "string" ? t.release_date : null,
          createdAt: typeof t.created_at === "string" ? t.created_at : null,
        }))
        .filter((x) => x.url);
    }
    return [];
  }, [soundcloudListTab, soundcloudPlays, soundcloudRecent]);

  const soundcloudProfileHref = useMemo(() => {
    const s = EPK.socials?.find(
      (x) => String(x.label || "").toLowerCase() === "soundcloud",
    );
    return typeof s?.href === "string" && /^https?:\/\//i.test(s.href.trim())
      ? s.href.trim()
      : "https://soundcloud.com/viggysounds";
  }, []);

  const originalsTracks = useMemo(
    () => parseMusicYaml(originalsYamlRaw, "original"),
    [],
  );
  const remixesTracks = useMemo(
    () => parseMusicYaml(remixesYamlRaw, "remix"),
    [],
  );
  const musicTracks =
    musicFilter === "original"
      ? originalsTracks
      : musicFilter === "remix"
        ? remixesTracks
        : [];

  const latestReleaseTrack = useMemo(() => {
    const dated = musicTracks
      .map((t) => ({ t, d: parseTrackReleaseDate(t.releaseDate) }))
      .filter((x) => x.d != null);
    if (dated.length === 0) return null;
    dated.sort((a, b) => b.d - a.d);
    return dated[0].t;
  }, [musicTracks]);

  const latestReleaseKey = latestReleaseTrack
    ? `${latestReleaseTrack.type}-${latestReleaseTrack.title}-${latestReleaseTrack.releaseDate}`
    : null;

  const buildVersion = import.meta.env.VITE_BUILD_VERSION || "local";
  const buildSha = import.meta.env.VITE_BUILD_SHA
    ? String(import.meta.env.VITE_BUILD_SHA).slice(0, 7)
    : null;
  const buildBranch = import.meta.env.VITE_BUILD_BRANCH || null;
  const buildLabel = buildSha
    ? `v${buildVersion} · ${buildSha}${buildBranch ? ` · ${buildBranch}` : ""}`
    : `v${buildVersion}`;

  return (
    <div className="page">
      {!backendOnline ? (
        <div
          className="backendOffline"
          style={{
            background: "#ffefef",
            color: "#611",
            padding: "6px 12px",
            textAlign: "center",
          }}
        >
          Backend offline — some features unavailable.
          <button
            type="button"
            style={{ marginLeft: 8 }}
            onClick={() => pingBackend()}
          >
            Retry
          </button>
        </div>
      ) : null}
      <header
        className="hero"
        style={{ backgroundImage: `url(${EPK.hero.backgroundImage})` }}
      >
        <div className="heroOverlay" />
        <div className="container heroInner">
          <div className="heroBrand">
            <h1 className="heroTitle">
              {EPK.logo ? (
                <img
                  className="heroLogo"
                  src={EPK.logo}
                  alt={EPK.artistName}
                  loading="eager"
                />
              ) : (
                EPK.artistName
              )}
            </h1>
            <p
              className="heroTagline heroTaglineCinematic"
              aria-label={EPK.artistTagline}
            >
              <span className="heroTaglineStack" aria-hidden="true">
                <span className="heroTaglineUnder">{EPK.artistTagline}</span>
                <span className="heroTaglineGradient">{EPK.artistTagline}</span>
              </span>
            </p>
          </div>

          {/* Quick actions moved to fixed header */}

          {/* Socials moved to fixed right-side column */}
        </div>
      </header>

      <SocialsFixed items={EPK.socials} />
      <FixedQuickActions items={EPK.quickActions} />

      <main className="container main">
        <section className="section" id="about">
          <div className="sectionHeader sectionHeaderCentered">
            <h2>About</h2>
          </div>
          <div className="aboutCard">
            <img
              className="aboutPhoto"
              src="/media/photos/Headshot.png"
              alt={`${EPK.artistName} headshot`}
              loading="eager"
            />
            <div className="aboutBody">
              <p className="aboutLead">
                VIGGY is a Denver-based producer and DJ making electronic bass
                music with a cinematic edge.
              </p>

              <p>
                His music pulls from the emotion and atmosphere of film scores
                and combines it with the energy of dubstep, experimental bass,
                and trap. The result is a sound that can feel beautiful and
                nostalgic one second, then completely flip the next.
              </p>

              <p>
                That approach comes through in his bass reimagining of{" "}
                <strong>Hans Zimmer’s “Time,”</strong> where one of film music’s
                most recognizable pieces is rebuilt through the VIGGY
                sound—keeping the emotion of the original while taking it
                somewhere much heavier.
              </p>

              <p>
                At the center of the project is <strong>cinematic bass</strong>:
                music that tells a story, builds a world, and still hits hard on
                a festival system.
              </p>

              <p>
                For VIGGY, it’s never just about making the biggest drop.{" "}
                <strong>
                  It’s about making you feel something before it hits.
                </strong>
              </p>
            </div>
          </div>
        </section>
        <section className="section" id="listen">
          <div className="sectionHeader sectionHeaderCentered">
            <h2>Music</h2>
          </div>

          <div
            className="musicToolbar"
            role="tablist"
            aria-label="Music filters"
          >
            <button
              type="button"
              className={`filterBtn ${musicFilter === "original" ? "filterBtnActive" : ""}`}
              role="tab"
              aria-selected={musicFilter === "original"}
              onClick={() => setMusicFilter("original")}
            >
              Originals
            </button>
            <button
              type="button"
              className={`filterBtn ${musicFilter === "remix" ? "filterBtnActive" : ""}`}
              role="tab"
              aria-selected={musicFilter === "remix"}
              onClick={() => setMusicFilter("remix")}
            >
              Remixes
            </button>
          </div>

          {latestReleaseTrack ? (
            <p className="musicGalleryHint">
              Latest: <strong>{latestReleaseTrack.title}</strong>
              {latestReleaseTrack.releaseDate
                ? ` · ${formatDate(latestReleaseTrack.releaseDate)}`
                : ""}
            </p>
          ) : null}

          <div className="musicArtGrid" aria-label="Music releases">
            {musicTracks.length === 0 ? (
              <div className="emptyState">
                No music entries yet. Add tracks in the YAML files.
              </div>
            ) : null}

            {musicTracks.map((t, idx) => {
              const key = `${t.type || "track"}-${t.title}-${idx}`;
              const isLatest =
                latestReleaseKey &&
                `${t.type}-${t.title}-${t.releaseDate}` === latestReleaseKey;

              return (
                <article
                  key={key}
                  className={`musicArtTile${isLatest ? " musicArtTileLatest" : ""}`}
                  tabIndex={0}
                  aria-label={t.title}
                >
                  <div className="musicArtTileFrame">
                    {t.coverArt ? (
                      <img
                        className="musicArtTileImg"
                        src={t.coverArt}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="musicArtTileImg musicArtTileImgPlaceholder"
                        aria-hidden="true"
                      />
                    )}
                    <div className="musicArtTileOverlay">
                      <h3 className="musicArtTileTitle">{t.title}</h3>
                      <MusicLinksRow
                        track={t}
                        className="musicArtTileLinks"
                      />
                    </div>
                    {isLatest ? (
                      <span className="musicArtTileBadge">Latest</span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <div
            className="musicSpotifyPanel sectionSpotify"
            id="spotify-catalog"
            aria-label="Spotify artist"
          >
            <SpotifyArtistCatalog
              status={spotifyArtistCatalog.status}
              meta={spotifyArtistCatalog.meta}
            />
          </div>

          <SoundcloudCarousel
            items={soundcloudEmbedItems}
            status={
              soundcloudListTab === "plays"
                ? soundcloudPlays.status
                : soundcloudRecent.status
            }
            listTab={soundcloudListTab}
            onListTabChange={setSoundcloudListTab}
            profileHref={soundcloudProfileHref}
            prefersReducedMotion={prefersReducedMotion}
          />
        </section>

        <section className="section" id="shows-upcoming">
          <div className="sectionHeader">
            <h2>Upcoming Shows</h2>
          </div>
          <div className="showList">
            {upcoming.map((s) => {
              const showLink =
                typeof s.href === "string"
                  ? s.href.trim()
                  : typeof s.tickets === "string"
                    ? s.tickets.trim()
                    : "";

              return (
                <div key={s.date + s.title} className="showCard">
                  <div className="showDate">{formatDate(s.date)}</div>
                  <div className="showInfo">
                    <div className="showTitle">{s.title}</div>
                    <div className="showVenue">
                      {s.venue} · {s.city}
                    </div>
                  </div>
                  {showLink ? (
                    <a
                      className="pillBtn"
                      href={showLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.statusLabel || "Tickets"}
                    </a>
                  ) : (
                    <div className="pillBtn pillBtnDisabled">
                      {s.statusLabel || "Details"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="section" id="shows-past">
          <div className="sectionHeader">
            <h2>Past Shows</h2>
          </div>
          <div className="showList">
            {past.map((s) => {
              const instagramHref =
                typeof s.instagram === "string" ? s.instagram.trim() : "";
              return (
                <div key={s.date + s.title} className="showCard showCardAlt">
                  <div className="showDate">{formatDate(s.date)}</div>
                  <div className="showInfo">
                    <div className="showTitle">{s.title}</div>
                    <div className="showVenue">
                      {s.venue} · {s.city}
                    </div>
                  </div>
                  {instagramHref ? (
                    <a
                      className="pillBtn pillBtnInstagram"
                      href={instagramHref}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Instagram highlights — ${s.title}`}
                    >
                      <SiInstagram className="pillBtnIcon" aria-hidden />
                      Highlights
                    </a>
                  ) : (
                    <div className="pillBtn pillBtnDisabled">Saved</div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="section" id="media">
          <div className="sectionHeader">
            <h2>Media</h2>
          </div>
          {showPhotoCount > 0 ? (
            musicCompact ? (
              <>
                <div
                  className="mediaSlideshow"
                  onMouseEnter={() => setPhotoSlidePaused(true)}
                  onMouseLeave={() => setPhotoSlidePaused(false)}
                  onPointerDown={() => setPhotoSlidePaused(true)}
                  onPointerUp={() => setPhotoSlidePaused(false)}
                  onPointerCancel={() => setPhotoSlidePaused(false)}
                  onKeyDown={(e) => {
                    if (showPhotoCount <= 1) return;
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      setPhotoSlideIndex(
                        (i) => (i - 1 + showPhotoCount) % showPhotoCount,
                      );
                    } else if (e.key === "ArrowRight") {
                      e.preventDefault();
                      setPhotoSlideIndex((i) => (i + 1) % showPhotoCount);
                    }
                  }}
                  role="region"
                  aria-roledescription="carousel"
                  aria-label="Show photos"
                  tabIndex={0}
                >
                  <div className="mediaSlideshowStage">
                    <div className="mediaSlideshowViewport">
                      <div
                        className="mediaSlideshowTrack"
                        style={{
                          width: `${showPhotoCount * 100}%`,
                          transform: `translateX(-${(photoSlideIndex * 100) / showPhotoCount}%)`,
                        }}
                      >
                        {showPhotosList.map((p, idx) => (
                          <div
                            key={p.src + idx}
                            className="mediaSlideshowSlide"
                            style={{ width: `${100 / showPhotoCount}%` }}
                            aria-hidden={idx !== photoSlideIndex}
                          >
                            <button
                              type="button"
                              className="mediaPhotoButton mediaSlideshowPhotoBtn"
                              onClick={() => {
                                setActiveVideoId(null);
                                setLightboxPhoto({
                                  src: p.src,
                                  alt: p.alt || `Show photo ${idx + 1}`,
                                });
                              }}
                              aria-label={`Expand photo: ${p.alt || `Photo ${idx + 1}`}`}
                            >
                              <img
                                className="mediaImg"
                                src={p.src}
                                alt=""
                                loading={idx === 0 ? "eager" : "lazy"}
                              />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {showPhotoCount > 1 ? (
                      <>
                        <button
                          type="button"
                          className="mediaSlideshowArrow mediaSlideshowArrowPrev"
                          onClick={() =>
                            setPhotoSlideIndex(
                              (i) => (i - 1 + showPhotoCount) % showPhotoCount,
                            )
                          }
                          aria-label="Previous photo"
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          className="mediaSlideshowArrow mediaSlideshowArrowNext"
                          onClick={() =>
                            setPhotoSlideIndex((i) => (i + 1) % showPhotoCount)
                          }
                          aria-label="Next photo"
                        >
                          ›
                        </button>
                      </>
                    ) : null}
                  </div>

                  {showPhotoCount > 1 ? (
                    <div
                      className="mediaSlideshowDots"
                      role="tablist"
                      aria-label="Photo slides"
                    >
                      {showPhotosList.map((p, idx) => (
                        <button
                          key={`dot-${p.src}-${idx}`}
                          type="button"
                          role="tab"
                          aria-selected={idx === photoSlideIndex}
                          aria-label={`Photo ${idx + 1}`}
                          className={
                            idx === photoSlideIndex
                              ? "mediaSlideshowDot mediaSlideshowDotActive"
                              : "mediaSlideshowDot"
                          }
                          onClick={() => setPhotoSlideIndex(idx)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <h5>Click on a photo to expand</h5>
                <div className="mediaGrid" aria-label="Show photos grid">
                  {showPhotosList.map((p, idx) => (
                    <button
                      key={p.src + idx}
                      type="button"
                      className="mediaItem mediaItemPhoto mediaPhotoButton"
                      onClick={() => {
                        setActiveVideoId(null);
                        setLightboxPhoto({
                          src: p.src,
                          alt: p.alt || `Show photo ${idx + 1}`,
                        });
                      }}
                      aria-label={`Expand photo: ${p.alt || `Photo ${idx + 1}`}`}
                    >
                      <img
                        className="mediaImg"
                        src={p.src}
                        alt=""
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </>
            )
          ) : (
            <p className="muted">No show photos yet.</p>
          )}
        </section>

        <section className="section" id="youtube">
          <div className="sectionHeader">
            <h2>YouTube Videos</h2>
          </div>
          <div className="youtubeGrid">
            {EPK.youtubeVideos.map((v) => (
              <button
                key={v.videoId + v.title}
                type="button"
                className="youtubeCard"
                onClick={() => {
                  setLightboxPhoto(null);
                  setActiveVideoId(v.videoId);
                }}
              >
                <div className="youtubeThumbWrap">
                  <img
                    className="youtubeThumb"
                    src={youtubeThumb(v.videoId)}
                    alt={v.title}
                    loading="lazy"
                  />
                  <div className="youtubePlay" aria-hidden="true">
                    ▶
                  </div>
                </div>
                <div className="youtubeTitle">{v.title}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="section footerSection" id="contact">
          <div className="footerCard footerCardForm">
            <div className="contactIntro">
              <h2 style={{ margin: 0 }}>{EPK.contact.label}</h2>
              <p className="muted" style={{ marginTop: 8 }}>
                Festivals, venues, collabs — send a note and I’ll get back to
                you.
              </p>
            </div>
            <form
              className="contactForm"
              onSubmit={handleContactSubmit}
              noValidate
            >
              <div className="contactFields">
                <label className="fieldLabel" htmlFor="contact-name">
                  Name
                </label>
                <input
                  id="contact-name"
                  className="fieldInput"
                  type="text"
                  name="name"
                  autoComplete="name"
                  required
                  value={contactName}
                  onChange={(e) => {
                    clearContactFeedback();
                    setContactName(e.target.value);
                  }}
                  placeholder="Your name"
                />
                <label className="fieldLabel" htmlFor="contact-email">
                  Email
                </label>
                <input
                  id="contact-email"
                  className="fieldInput"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={contactEmail}
                  onChange={(e) => {
                    clearContactFeedback();
                    setContactEmail(e.target.value);
                  }}
                  placeholder="you@example.com"
                />
                <label className="fieldLabel" htmlFor="contact-message">
                  Message
                </label>
                <textarea
                  id="contact-message"
                  className="fieldTextarea"
                  name="message"
                  required
                  rows={5}
                  value={contactMessage}
                  onChange={(e) => {
                    clearContactFeedback();
                    setContactMessage(e.target.value);
                  }}
                  placeholder="Lets make magic happen…"
                />
              </div>
              {contactStatus === "error" && contactErrorText ? (
                <p className="formMessage formMessageError" role="alert">
                  {contactErrorText}
                </p>
              ) : null}
              {contactStatus === "success" ? (
                <p className="formMessage formMessageSuccess" role="status">
                  Sent — thanks, I’ll reply soon.
                </p>
              ) : null}
              <button
                className="contactSubmit"
                type="submit"
                disabled={contactStatus === "sending"}
              >
                {contactStatus === "sending" ? "Sending…" : "Send message"}
              </button>
            </form>
          </div>

          <div className="finePrint">
            © {new Date().getFullYear()} {EPK.artistName}. All rights reserved.
            <br />
            Build {buildLabel}
          </div>
        </section>
      </main>

      {lightboxPhoto ? (
        <div
          className="modalOverlay modalOverlayPhoto"
          role="dialog"
          aria-modal="true"
          aria-label="Photo lightbox"
        >
          <button
            className="modalBackdropButton modalBackdropPhoto"
            type="button"
            onClick={() => setLightboxPhoto(null)}
            aria-label="Close photo"
          />
          <div className="modal modalLightbox">
            <div className="modalHeader modalHeaderLightbox">
              <div className="modalTitle">{lightboxPhoto.alt}</div>
              <button
                className="modalClose"
                type="button"
                onClick={() => setLightboxPhoto(null)}
                aria-label="Close photo"
              >
                ✕
              </button>
            </div>
            <div className="modalBodyLightbox">
              <img
                className="lightboxImg"
                src={lightboxPhoto.src}
                alt={lightboxPhoto.alt}
              />
            </div>
          </div>
        </div>
      ) : null}

      {activeVideo ? (
        <div
          className="modalOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="YouTube video modal"
        >
          <button
            className="modalBackdropButton"
            type="button"
            onClick={() => setActiveVideoId(null)}
            aria-label="Close modal"
          />
          <div className="modal">
            <div className="modalHeader">
              <div className="modalTitle">{activeVideo.title}</div>
              <button
                className="modalClose"
                type="button"
                onClick={() => setActiveVideoId(null)}
                aria-label="Close video"
              >
                ✕
              </button>
            </div>
            <div className="modalBody">
              <iframe
                title={activeVideo.title}
                src={`https://www.youtube.com/embed/${activeVideo.videoId}?autoplay=1`}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
            <div className="modalFooter">
              <a
                className="textLink"
                href={`https://www.youtube.com/watch?v=${activeVideo.videoId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on YouTube →
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
