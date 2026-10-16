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
 * Whether an error from PostgREST or GoTrue means the service-role key is wrong or rejected
 * (status 401 or 403, or a PostgREST JWT error), a configuration fault a retry can't fix, rather
 * than a storage fault. Every other error, including other 4xx and Postgres codes, is not.
 */
export function isAuthRejection(error: ServiceErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 401 || error.status === 403) return true;
  return error.code !== undefined && POSTGREST_JWT_CODES.has(error.code);
}
