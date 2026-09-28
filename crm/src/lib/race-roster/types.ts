export const RACE_ROSTER_PROVIDER = "race_roster" as const;

export type RaceRosterTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
};

export type RaceRosterRegion = {
  code?: string;
  name?: string;
};

export type RaceRosterCountry = {
  code?: string;
  name?: string;
};

export type RaceRosterBranding = {
  logo?: string | null;
  backgroundImage?: string | null;
  backgroundPattern?: string | null;
  backgroundColor?: string | null;
  primaryColor?: string | null;
  primaryFontColor?: string | null;
  secondaryColor?: string | null;
  secondaryFontColor?: string | null;
  tertiaryColor?: string | null;
  tertiaryFontColor?: string | null;
};

export type RaceRosterSubEventDistance = {
  id?: string;
  type?: string;
  label?: string;
  value?: string | number;
  unit?: string;
  inMeters?: string | number;
};

export type RaceRosterSubEvent = {
  subEventId: number | string;
  name?: string;
  maxParticipants?: string | number;
  participantMinAge?: string | number;
  participantMaxAge?: string | number;
  subEventDistance?: RaceRosterSubEventDistance | null;
  distance?: string | number;
  distanceType?: string;
  customSubEventDate?: string | null;
};

export type RaceRosterEvent = {
  eventId: string | number;
  type?: string;
  name: string;
  city?: string | null;
  region?: RaceRosterRegion | null;
  country?: RaceRosterCountry | null;
  startDate?: string | null;
  timeZone?: string | null;
  registrationOpenDate?: string | null;
  registrationCloseDate?: string | null;
  lastModifiedDate?: string | null;
  url?: string | null;
  organizerName?: string | null;
  organizerEmail?: string | null;
  organizerPhone?: string | null;
  organizerDashboardUrl?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locale?: string | null;
  description?: string | null;
  facebook?: string | null;
  twitter?: string | null;
  branding?: RaceRosterBranding | null;
  resultsUrl?: string | null;
  subEvents?: { data?: RaceRosterSubEvent[] } | RaceRosterSubEvent[] | null;
};

export type RaceRosterCredentials = {
  clientId: string;
  clientSecret: string;
  username?: string;
  password?: string;
  refreshToken?: string;
  clientName?: string;
};

export type MappedCatalogListing = {
  sourceProvider: typeof RACE_ROSTER_PROVIDER;
  sourceRaceId: number;
  raceRosterEventId: string;
  name: string;
  slug: string;
  descriptionHtml: string | null;
  logoUrl: string | null;
  registrationUrl: string | null;
  externalRaceUrl: string | null;
  externalResultsUrl: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  countryCode: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  nextStartAt: string | null;
  firstStartAt: string | null;
  lastStartAt: string | null;
  isRegistrationOpen: boolean | null;
  sourceLastFetchedAt: string;
  sourceLastModified: string | null;
};

export type MappedCatalogEdition = {
  sourceProvider: typeof RACE_ROSTER_PROVIDER;
  sourceRaceId: number;
  sourceRaceEventDaysId: number;
  editionYear: number | null;
  startsAt: string | null;
  timezone: string | null;
  isFuture: boolean;
  isHistorical: boolean;
  offeringCount: number;
  futureOfferingCount: number;
  historicalOfferingCount: number;
};

export type MappedCatalogOffering = {
  sourceProvider: typeof RACE_ROSTER_PROVIDER;
  sourceRaceId: number;
  sourceEventId: number;
  sourceRaceEventDaysId: number;
  name: string;
  distanceLabel: string | null;
  distanceMeters: number | null;
  startTimeRaw: string | null;
  startsAt: string | null;
  eventType: string | null;
  normalizedEventFamily: string | null;
  isRealRaceDistance: boolean;
  isVirtual: boolean;
  isWalk: boolean;
  isMerchOnly: boolean;
  isVolunteer: boolean;
  registrationPeriodsJson: unknown;
  rawJson: unknown;
};

export type MappedRaceRosterEvent = {
  listing: MappedCatalogListing;
  edition: MappedCatalogEdition;
  offerings: MappedCatalogOffering[];
};
