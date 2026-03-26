import React, { useEffect, useMemo, useState } from "react";
import { CONTACT_FORM_URL, EPK } from "./data/epk.js";
import showPhotos from "./generated/showPhotos.json";
import yaml from "js-yaml";
import originalsYamlRaw from "./data/music/originals.yaml?raw";
import remixesYamlRaw from "./data/music/remixes.yaml?raw";

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

export default function App() {
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [musicFilter, setMusicFilter] = useState("both"); // original | remix | both
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
        : [...originalsTracks, ...remixesTracks];

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
              className={`filterBtn ${musicFilter === "both" ? "filterBtnActive" : ""}`}
              role="tab"
              aria-selected={musicFilter === "both"}
              onClick={() => setMusicFilter("both")}
            >
              All
            </button>
          </div>

          <div className="musicGrid" aria-label="Music list">
            {musicTracks.length === 0 ? (
              <div className="emptyState">
                No music entries yet. Add tracks in the YAML files.
              </div>
            ) : null}

            {musicTracks.map((t, idx) => (
              <div
                key={`${t.type || "track"}-${t.title}-${idx}`}
                className="musicCard"
              >
                <div className="musicCardTop">
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
                <div className="musicLinksRow">
                  {t.url ? (
                    <a
                      className="musicChip"
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                    >
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
              </div>
            ))}
          </div>
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
          <button
            className="modalBackdropButton modalBackdropPhoto"
            type="button"
            onClick={() => setLightboxPhoto(null)}
            aria-label="Close photo"
          />
        </div>
      ) : null}

      {activeVideo ? (
        <div
          className="modalOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="YouTube video modal"
        >
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
          <button
            className="modalBackdropButton"
            type="button"
            onClick={() => setActiveVideoId(null)}
            aria-label="Close modal"
          />
        </div>
      ) : null}
    </div>
  );
}
