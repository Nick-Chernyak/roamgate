import { isDesktop } from "./desktop";

export const APP_NAME = isDesktop() ? "Musipusi" : "Roamgate";
export const APP_ICON = isDesktop() ? "/musipusi.png" : "/roamgate-mark-48.png";
