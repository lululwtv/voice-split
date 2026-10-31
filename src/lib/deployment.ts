/** The public site is the pitch and the sample only. The speech engine runs on a person's own computer. */
export const isDeployedSite = import.meta.env.VITE_DEPLOYED === "true";

/** Set when the demo video is ready. The video section shows an empty frame until then. */
export const demoVideoUrl: string | undefined = import.meta.env.VITE_DEMO_VIDEO_URL;
