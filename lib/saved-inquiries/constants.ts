/** Default page size for the saved-inquiry list. */
export const SAVED_INQUIRY_PAGE_SIZE = 20;

/** Hard ceiling for a single list request. */
export const SAVED_INQUIRY_MAX_PAGE_SIZE = 50;

/** Reject an export that would include more than this many product rows. */
export const SAVED_INQUIRY_MAX_EXPORT_ROWS = 5_000;

/** Search string cap so ilike filters stay bounded. */
export const SAVED_INQUIRY_MAX_QUERY_LENGTH = 100;

export const SAVED_INQUIRY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const SAVED_INQUIRY_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
