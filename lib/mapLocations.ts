export const OVERTURE_ATTRIBUTION_URL = "https://docs.overturemaps.org/attribution/#places";

export type MapNotice = { label: string; url: string };
export type MapLocation = {
  slug: string;
  name: string;
  area: string | null;
  address: string | null;
  cuisine: string | null;
  videoCount: number;
  position: [lng: number, lat: number];
  notices: MapNotice[];
};
