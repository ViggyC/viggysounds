export const EPK = {
  artistName: "VIGGYtunes",
  // Logo to show in the hero. Upload your file to `public/media/cover-art/` and update this path if needed.
  // Use a relative path (no leading `/`) so it works on GitHub Pages project subpaths.
  logo: "media/art/VIGGY_NEW_LOGO.png",
  artistTagline: "Cinematic Bass Music",
  /** Line above hero social icon buttons */
  socialCta: "Follow me 👉🏾👈🏾",
  hero: {
    // Replace with your own background photo later (put it in `public/` if you want it local).
    backgroundImage: "media/photos/viggy_hero.jpg",
  },
  socials: [
    {
      label: "Instagram",
      href: "https://instagram.com/viggysounds",
      external: true,
      brandColor: "#E1306C",
    },
    {
      label: "SoundCloud",
      href: "https://soundcloud.com/viggysounds",
      external: true,
      brandColor: "#FF5500",
    },
    {
      label: "Spotify",
      href: "https://open.spotify.com/artist/1LGq6HsdkJncPPY1rmDB4s?si=ilQCyzrOSyCjcjevrl6eFg",
      external: true,
      brandColor: "#1DB954",
    },
    {
      label: "TikTok",
      href: "https://www.tiktok.com/@viggysoundz",
      external: true,
      brandColor: "#25F4EE",
    },
    {
      label: "YouTube",
      href: "https://youtube.com/@viggysounds",
      external: true,
      brandColor: "#FF0000",
    },
  ],
  upcomingShows: [
    {
      date: "July 10-11, 2026",
      title: "QForest",
      venue: "Lake George, CO",
      city: "Lake George, CO",
      statusLabel: "Tickets",
      href: "https://tickets.qforestfestival.com/?coupon=Viggy2026",
    },
  ],
  pastShows: [
    {
      date: "2026-03-12",
      title: "MYRIAS & JiLLi w/ Wizzy Wonk + VIGGY",
      venue: "Larimer Lounge",
      city: "Denver, CO",
    },
    {
      date: "2025-12-18",
      title:
        "Ski House presents Bassmass Ft. VIGGY, THUG CITY, Brownee + All Nighter",
      venue: "Larimer Lounge",
      city: "Denver, CO",
    },
  ],
  youtubeVideos: [
    {
      title: "Full Live DJ Set @ Larimer Lounge",
      videoId: "gJEODcIixys",
    },
  ],
  quickActions: [
    { label: "Upcoming Shows", href: "#shows-upcoming" },
    { label: "Listen", href: "#listen" },
    { label: "Media", href: "#media" },
    { label: "YouTube", href: "#youtube" },
  ],
  contact: {
    email: "viggysounds@gmail.com",
    label: "Booking / Collabs",
  },
};

/** POST JSON { name, email, message } — override with VITE_CONTACT_API_URL in .env */
export const CONTACT_FORM_URL =
  import.meta.env.VITE_CONTACT_API_URL ??
  "https://vigneshchandrasekhar.fly.dev/send_mail";
