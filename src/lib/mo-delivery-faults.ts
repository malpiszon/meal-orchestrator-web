/** The fields an error from PostgREST (`code`) or GoTrue (`status`, `code`) may carry. */
interface ServiceErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

/**
 * PostgREST JWT errors: PGRST301 (the JWT can't be decoded or its signature is wrong) and PGRST302
 * (a request with no JWT where anonymous access is off). Both mean the key, not the data, is wrong.
 */
const POSTGREST_JWT_CODES: ReadonlySet<string> = new Set(["PGRST301", "PGRST302"]);

/**
 * GoTrue error codes for a service key it rejects. A GoTrue 403 counts as a wrong key only with one of
 * these; any other 403 keeps its storage path, so one email's fault isn't reported as configuration.
 */
const GOTRUE_KEY_REJECTION_CODES: ReadonlySet<string> = new Set(["bad_jwt", "not_admin", "no_authorization"]);

/**
 * Whether a PostgREST error means the service-role key is wrong or rejected (status 401 or 403, or
 * a PostgREST JWT error), a configuration fault a retry can't fix, rather than a storage fault.
 * Every other error, including other 4xx and Postgres codes, is not. For GoTrue errors use
 * `isGoTrueKeyRejection`, which is stricter about 403.
 */
export function isAuthRejection(error: ServiceErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 401 || error.status === 403) return true;
  return error.code !== undefined && POSTGREST_JWT_CODES.has(error.code);
}

/** Whether a GoTrue admin error means the service key is rejected: any 401, or a 403 with a key-error code. */
export function isGoTrueKeyRejection(error: ServiceErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.status === 401 || (error.status === 403 && GOTRUE_KEY_REJECTION_CODES.has(error.code ?? ""));
}
