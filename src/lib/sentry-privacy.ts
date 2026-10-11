// Shared by the Worker and the browser SDK, so only type imports from Sentry: nothing Worker-only may reach the client bundle.
import type { Breadcrumb, DataCollection, ErrorEvent } from "@sentry/core";

export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpBodies: [],
  urlQueryParams: false,
  // Never `referer`: it repeats URLs with their query, which can carry a `token_hash`.
  httpHeaders: { request: { allow: ["user-agent", "content-type", "accept"] }, response: false },
};

// `%40`: an address inside an encoded URL that an error message repeats.
const EMAIL_PATTERN = /[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)+/gi;
const BREADCRUMB_URL_KEYS = ["url", "from", "to"] as const;

function maskEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, "[email]");
}

function stripQueryAndFragment(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const scrubbed: Breadcrumb = { ...breadcrumb };

  if (scrubbed.message !== undefined) {
    scrubbed.message = maskEmails(scrubbed.message);
  }

  if (scrubbed.data) {
    // Console breadcrumbs repeat the raw log arguments next to `message`; fetch ones keep the URL's query and fragment.
    const {
      arguments: _arguments,
      "url.query": _query,
      "url.fragment": _fragment,
      ...data
    }: Record<string, unknown> = scrubbed.data;
    for (const key of BREADCRUMB_URL_KEYS) {
      const value = data[key];
      if (typeof value === "string") {
        data[key] = stripQueryAndFragment(value);
      }
    }
    scrubbed.data = data;
  }

  return scrubbed;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { user: _user, ...scrubbed } = event;
  // Without a user, Sentry fills in the sender's IP (and its geo) unless the SDK says not to.
  scrubbed.sdk = { ...scrubbed.sdk, settings: { ...scrubbed.sdk?.settings, infer_ip: "never" } };

  if (scrubbed.request) {
    const { query_string: _query, cookies: _cookies, data: _data, ...request } = scrubbed.request;
    if (request.url !== undefined) {
      request.url = stripQueryAndFragment(request.url);
    }
    scrubbed.request = request;
  }

  if (scrubbed.message !== undefined) {
    scrubbed.message = maskEmails(scrubbed.message);
  }

  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((exception) =>
        exception.value === undefined ? exception : { ...exception, value: maskEmails(exception.value) },
      ),
    };
  }

  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(scrubBreadcrumb);
  }

  return scrubbed;
}
