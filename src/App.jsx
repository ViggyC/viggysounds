import React, { useEffect, useMemo, useState } from "react";
import { CONTACT_FORM_URL, EPK } from "./data/epk.js";
import showPhotos from "./generated/showPhotos.json";
import yaml from "js-yaml";
import originalsYamlRaw from "./data/music/originals.yaml?raw";
import remixesYamlRaw from "./data/music/remixes.yaml?raw";
import { SOUNDCLOUD_EMBED_FALLBACK } from "./data/soundcloudTopTracks.js";

function formatDate(dateStr) {
  // Expected: YYYY-MM-DD
  const dt = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return dateStr;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(dt);
}

function isValidDate(dateStr) {
  const dt = new Date(`${dateStr}T00:00:00`);
  return !Number.isNaN(dt.getTime());
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

function MusicLinksRow({ track: t }) {
  return (
    <div className="musicLinksRow">
      {t.url ? (
        <a className="musicChip" href={t.url} target="_blank" rel="noreferrer">
          Listen
        </a>
      ) : null}
      {t.spotify ? (
        <a
          className="musicChip"
          href={t.spotify}
          target="_blank"
          rel="noreferrer"
        >
          Spotify
        </a>
      ) : null}
      {t.soundcloud ? (
        <a
          className="musicChip"
          href={t.soundcloud}
          target="_blank"
          rel="noreferrer"
        >
          SoundCloud
        </a>
      ) : null}
    </div>
  );
}

export default function App() {
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [musicFilter, setMusicFilter] = useState("both"); // original | remix | both | soundcloud
  /** Narrow viewports: compact music rows; expand for cover, description, links */
  const musicCompact = useMediaQuery("(max-width: 560px)");
  const [musicExpanded, setMusicExpanded] = useState({});
  const [soundcloudPanelOpen, setSoundcloudPanelOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactStatus, setContactStatus] = useState("idle"); // idle | sending | success | error
  const [contactErrorText, setContactErrorText] = useState("");

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
      const res = await fetch(CONTACT_FORM_URL, {
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

  const upcoming = useMemo(() => {
    return [...EPK.upcomingShows].sort((a, b) => {
      const aOk = isValidDate(a.date);
      const bOk = isValidDate(b.date);
      if (aOk && bOk)
        return new Date(`${a.date}T00:00:00`) - new Date(`${b.date}T00:00:00`);
      if (aOk) return -1;
      if (bOk) return 1;
      return String(a.date).localeCompare(String(b.date));
    });
  }, []);

  const past = useMemo(() => {
    return [...EPK.pastShows].sort((a, b) => {
      const aOk = isValidDate(a.date);
      const bOk = isValidDate(b.date);
      if (aOk && bOk)
        return new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`);
      if (aOk) return -1;
      if (bOk) return 1;
      return String(b.date).localeCompare(String(a.date));
    });
  }, []);

  const activeVideo =
    activeVideoId && EPK.youtubeVideos.find((v) => v.videoId === activeVideoId);

  useEffect(() => {
    setMusicExpanded({});
  }, [musicFilter]);

  useEffect(() => {
    if (musicFilter === "soundcloud") {
      setSoundcloudPanelOpen(true);
    }
  }, [musicFilter]);

  const [soundcloudTop, setSoundcloudTop] = useState({
    status: "loading",
    tracks: [],
  });

  useEffect(() => {
    const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
    const url = base
      ? `${base}/api/soundcloud/top-tracks?limit=5`
      : "/api/soundcloud/top-tracks?limit=5";
    let cancelled = false;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
        setSoundcloudTop({
          status: tracks.length > 0 ? "ok" : "empty",
          tracks,
        });
      })
      .catch(() => {
        if (!cancelled) setSoundcloudTop({ status: "error", tracks: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** API rows include playback_count; fallback list is URL-only */
  const soundcloudEmbedItems = useMemo(() => {
    if (soundcloudTop.status === "ok" && soundcloudTop.tracks.length > 0) {
      return soundcloudTop.tracks
        .map((t) => ({
          url: t.permalink_url,
          title: typeof t.title === "string" ? t.title : "",
          playbackCount:
            typeof t.playback_count === "number" ? t.playback_count : null,
        }))
        .filter((x) => x.url);
    }
    if (soundcloudTop.status === "loading") return [];
    return SOUNDCLOUD_EMBED_FALLBACK.map((u) => ({
      url: u,
      title: "",
      playbackCount: null,
    }));
  }, [soundcloudTop]);

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
        : musicFilter === "soundcloud"
          ? []
          : [...originalsTracks, ...remixesTracks];

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
            <p className="heroTagline">{EPK.artistTagline}</p>
          </div>

          <div className="quickLinks" aria-label="Quick actions">
            {EPK.quickActions.map((a) => (
              <a key={a.label} className="linkBtn" href={a.href}>
                {a.label}
              </a>
            ))}
          </div>

          <div className="socialBlock">
            <p className="socialCta">{EPK.socialCta}</p>
            <div className="socialRow" aria-label="Social links">
              {EPK.socials.map((s) => (
                <a
                  key={s.label}
                  className="socialChip"
                  href={s.href}
                  target={s.external ? "_blank" : undefined}
                  rel="noreferrer"
                  style={
                    s.brandColor
                      ? {
                          borderColor: hexToRgba(s.brandColor, 0.38),
                          background: hexToRgba(s.brandColor, 0.12),
                        }
                      : undefined
                  }
                >
                  {s.brandColor ? (
                    <span
                      className="socialDot"
                      style={{
                        backgroundColor: s.brandColor,
                        boxShadow: `0 0 0 6px ${hexToRgba(s.brandColor, 0.13)}`,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {s.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="container main">
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
              className={`filterBtn ${musicFilter === "both" ? "filterBtnActive" : ""}`}
              role="tab"
              aria-selected={musicFilter === "both"}
              onClick={() => setMusicFilter("both")}
            >
              All
            </button>
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
            <button
              type="button"
              className={`filterBtn ${musicFilter === "soundcloud" ? "filterBtnActive" : ""}`}
              role="tab"
              aria-selected={musicFilter === "soundcloud"}
              onClick={() => setMusicFilter("soundcloud")}
            >
              SoundCloud
            </button>
          </div>

          {musicFilter === "soundcloud" &&
          (soundcloudTop.status === "loading" ||
            soundcloudEmbedItems.length > 0) ? (
            <div
              className={`soundcloudPanel${soundcloudPanelOpen ? " soundcloudPanelOpen" : ""}`}
            >
              <button
                type="button"
                className="soundcloudPanelHeader"
                id="soundcloud-panel-head"
                aria-expanded={soundcloudPanelOpen}
                aria-controls="soundcloud-panel-body"
                onClick={() => setSoundcloudPanelOpen((o) => !o)}
              >
                <div className="soundcloudPanelHeaderText">
                  <span className="soundcloudPanelTitle">Top tracks</span>
                  {soundcloudTop.status === "loading" ? (
                    <span className="soundcloudPanelMeta" role="status">
                      Loading…
                    </span>
                  ) : soundcloudTop.status === "ok" ? (
                    <span className="soundcloudPanelMeta">
                      Top tracks by play count
                    </span>
                  ) : (
                    <span className="soundcloudPanelMeta">Embeds</span>
                  )}
                  {soundcloudEmbedItems.length > 0 ? (
                    <span className="soundcloudPanelCount">
                      {soundcloudEmbedItems.length}{" "}
                      {soundcloudEmbedItems.length === 1 ? "track" : "tracks"}
                    </span>
                  ) : null}
                </div>
                <span className="soundcloudPanelChevron" aria-hidden="true">
                  ▼
                </span>
              </button>

              <div
                id="soundcloud-panel-body"
                className="soundcloudPanelBody"
                role="region"
                aria-labelledby="soundcloud-panel-head"
                hidden={!soundcloudPanelOpen}
              >
                {soundcloudPanelOpen && soundcloudEmbedItems.length > 0 ? (
                  <ul className="soundcloudWidgetList">
                    {soundcloudEmbedItems.map((item, i) => (
                      <li
                        key={`${item.url}-${i}`}
                        className="soundcloudWidgetItem"
                      >
                        {item.title || item.playbackCount != null ? (
                          <div className="soundcloudWidgetTrackMeta">
                            {item.title ? (
                              <span className="soundcloudWidgetTrackTitle">
                                {item.title}
                              </span>
                            ) : null}
                            {formatPlayCount(item.playbackCount) != null ? (
                              <span className="soundcloudWidgetPlays">
                                {formatPlayCount(item.playbackCount)} plays
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
                          loading="lazy"
                        />
                      </li>
                    ))}
                  </ul>
                ) : soundcloudPanelOpen &&
                  soundcloudTop.status === "loading" ? (
                  <p className="soundcloudPanelBodyLoading" role="status">
                    Loading players…
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {musicFilter !== "soundcloud" && latestReleaseTrack ? (
            <div
              className="musicLatestHighlight"
              role="region"
              aria-label="Latest release"
            >
              <div className="musicLatestHighlightInner">
                {latestReleaseTrack.coverArt ? (
                  <div className="musicLatestCoverWrap">
                    <img
                      className="musicLatestCover"
                      src={latestReleaseTrack.coverArt}
                      alt=""
                      loading="lazy"
                    />
                  </div>
                ) : null}
                <div className="musicLatestBody">
                  <div className="musicLatestBadge">Latest release</div>
                  <h3 className="musicLatestTitle">
                    {latestReleaseTrack.title}
                  </h3>
                  <p className="musicLatestDate">
                    {formatDate(latestReleaseTrack.releaseDate)}
                  </p>
                  {latestReleaseTrack.description ? (
                    <p className="musicLatestMeta">
                      {latestReleaseTrack.description}
                    </p>
                  ) : null}
                  <div className="musicLatestFooter">
                    <div
                      className={`musicTypePill ${latestReleaseTrack.type === "original" ? "musicTypeOriginal" : "musicTypeRemix"}`}
                    >
                      {latestReleaseTrack.type === "original"
                        ? "Original"
                        : "Remix"}
                    </div>
                    <MusicLinksRow track={latestReleaseTrack} />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {musicFilter !== "soundcloud" ? (
          <div className="musicGrid" aria-label="Music list">
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
              const expandId = `music-expand-${musicFilter}-${idx}`;
              const headingId = `music-h-${musicFilter}-${idx}`;
              const isExpanded = !musicCompact || !!musicExpanded[key];
              const toggleCard = () => {
                if (!musicCompact) return;
                setMusicExpanded((prev) => ({
                  ...prev,
                  [key]: !prev[key],
                }));
              };

              return (
                <div
                  key={key}
                  className={`musicCard${isLatest ? " musicCardLatest" : ""}${
                    musicCompact
                      ? isExpanded
                        ? " musicCardExpanded"
                        : " musicCardCollapsed"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    className="musicCardSummary"
                    id={headingId}
                    aria-expanded={musicCompact ? isExpanded : true}
                    aria-controls={expandId}
                    onClick={toggleCard}
                  >
                    {t.coverArt ? (
                      <img
                        className="musicCardThumb"
                        src={t.coverArt}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="musicCardThumb musicCardThumbPlaceholder"
                        aria-hidden="true"
                      />
                    )}
                    <div className="musicCardSummaryMain">
                      <div className="musicTitle">{t.title}</div>
                      <div
                        className={`musicTypePill ${t.type === "original" ? "musicTypeOriginal" : "musicTypeRemix"}`}
                      >
                        {t.type === "original" ? "Original" : "Remix"}
                      </div>
                    </div>
                    <span className="musicCardChevron" aria-hidden="true">
                      ▼
                    </span>
                  </button>

                  <div
                    id={expandId}
                    className="musicCardExpand"
                    role="region"
                    aria-labelledby={headingId}
                    hidden={musicCompact && !isExpanded}
                  >
                    <div className="musicCardTop musicCardExpandDesktopOnly">
                      <div className="musicTitle">{t.title}</div>
                      <div
                        className={`musicTypePill ${t.type === "original" ? "musicTypeOriginal" : "musicTypeRemix"}`}
                      >
                        {t.type === "original" ? "Original" : "Remix"}
                      </div>
                    </div>
                    {t.coverArt ? (
                      <img
                        className="musicCoverImg"
                        src={t.coverArt}
                        alt={`${t.title} cover art`}
                        loading="lazy"
                      />
                    ) : null}
                    {t.description ? (
                      <div className="musicMeta">{t.description}</div>
                    ) : null}
                    <MusicLinksRow track={t} />
                  </div>
                </div>
              );
            })}
          </div>
          ) : null}
        </section>

        <section className="section" id="shows-upcoming">
          <div className="sectionHeader">
            <h2>Upcoming Shows</h2>
          </div>
          <div className="showList">
            {upcoming.map((s) => (
              <div key={s.date + s.title} className="showCard">
                <div className="showDate">{formatDate(s.date)}</div>
                <div className="showInfo">
                  <div className="showTitle">{s.title}</div>
                  <div className="showVenue">
                    {s.venue} · {s.city}
                  </div>
                </div>
                {s.href ? (
                  <a
                    className="pillBtn"
                    href={s.href}
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
            ))}
          </div>
        </section>

        <section className="section" id="shows-past">
          <div className="sectionHeader">
            <h2>Past Shows</h2>
          </div>
          <div className="showList">
            {past.map((s) => (
              <div key={s.date + s.title} className="showCard showCardAlt">
                <div className="showDate">{formatDate(s.date)}</div>
                <div className="showInfo">
                  <div className="showTitle">{s.title}</div>
                  <div className="showVenue">
                    {s.venue} · {s.city}
                  </div>
                </div>
                <div className="pillBtn pillBtnDisabled">Saved</div>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="media">
          <div className="sectionHeader">
            <h2>Media</h2>
          </div>
          <h5>Click on a photo to expand</h5>

          <div className="mediaGrid">
            {(showPhotos || []).map((p, idx) => (
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
                <img className="mediaImg" src={p.src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
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
                  placeholder="Tell me about the gig, dates, vibe…"
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
