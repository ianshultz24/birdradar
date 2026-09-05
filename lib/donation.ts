/**
 * Eastside Audubon donation prompt — the URL, and the policy for when to ask.
 *
 * Split the way lib/alerts-sort.ts is split: the *decision* is a pure function so
 * it can be asserted on under `node --test` with no browser and no key (see
 * lib/donation.test.ts), and localStorage is a thin wrapper around it. A prompt
 * that asks for money at the wrong moment is not something to debug by reloading
 * a page thirty times.
 *
 * ─── The one constant that matters ───────────────────────────────────────────
 *
 * `EAS_DONATION_BASE` is a placeholder. John has not supplied the real Eastside
 * Audubon link yet; when he does, it replaces that one string and nothing else in
 * the repo changes. It is deliberately NOT exported, so no call site can link to
 * the bare page and drop the attribution parameters on the way.
 */

/**
 * TODO(john): swap in the real Eastside Audubon donation link.
 *
 * Ask which of two things it is, because it decides whether the parameters below
 * reach anyone:
 *
 *   - **A page on eastsideaudubon.org.** UTMs work the ordinary way and EAS's own
 *     analytics will attribute the visit.
 *   - **A raw Stripe Payment Link** (`buy.stripe.com/…`). Stripe accepts the five
 *     standard UTM codes, but they surface only on the *post-payment redirect URL*,
 *     and only when the link's confirmation behaviour is set to redirect rather
 *     than Stripe's default confirmation page. They are not attached to the
 *     Checkout Session and are not in the `checkout.session.completed` webhook, so
 *     EAS cannot reconcile a gift back to BirdRadar from them. The parameter that
 *     does reach Stripe's records is `client_reference_id`, which is attached to
 *     the Session and sent in that webhook — which is why it is set below.
 *
 * Either way, `donation_prompt_clicked` in PostHog is the attribution BirdRadar
 * controls end to end. Everything downstream of the click depends on EAS's
 * configuration, not on this code. Do not report the two as the same number.
 */
const EAS_DONATION_BASE = 'https://eastsideaudubon.org/donate';

/** Which surface sent the user. The banner uses the campaign named in the brief. */
export type DonationCampaign = 'donate_prompt' | 'donate_settings';

/**
 * Built with `URL` + `searchParams`, never string concatenation.
 *
 * The entire design of `EAS_DONATION_BASE` is that an unknown URL gets pasted over
 * it later, and donation platforms routinely hand out links that already carry a
 * query string (`…/donate?form=…`, a Stripe link with `client_reference_id`
 * pre-set from the Dashboard's URL-parameters dialog). A hardcoded `?` would
 * produce a second one and every parameter after it would die silently — the kind
 * of failure nobody notices until a quarter of attribution is missing.
 *
 * A malformed paste returns the base unmodified rather than throwing inside a
 * click handler: a donation link that works without attribution beats a button
 * that does nothing.
 */
export function donationUrl(campaign: DonationCampaign): string {
  try {
    const url = new URL(EAS_DONATION_BASE);
    url.searchParams.set('utm_source', 'birdradar');
    url.searchParams.set('utm_medium', 'app');
    url.searchParams.set('utm_campaign', campaign);
    // Harmlessly ignored by an ordinary web page; the only thing that survives
    // into Stripe's records if the link turns out to be a Payment Link. See the
    // TODO above. Drop this line if John confirms a hosted page.
    url.searchParams.set('client_reference_id', `birdradar_${campaign}`);
    return url.toString();
  } catch {
    return EAS_DONATION_BASE;
  }
}

// ─── Thresholds ──────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Two page loads closer together than this are one visit.
 *
 * This is what makes `startSession()` idempotent under React's StrictMode
 * double-invoked mount effect in development, without a flag that would have to be
 * kept correct. It is also the honest definition: three reloads in a minute are
 * one session, not three.
 *
 * **Consequence worth knowing before reading PostHog:** the stamp is refreshed on
 * every mount, so the gap is measured between *page loads*, not from the start of
 * the visit. Someone using the app hard all afternoon, reloading every twenty
 * minutes, stays on session 1 and is never asked. That is the conservative
 * direction and almost certainly right — they get asked tomorrow — but it is a
 * real behaviour, and "the prompt looks under-triggered" is expected, not a bug.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Never during the first session. Checked before either trigger. */
export const MIN_SESSION_FOR_PROMPT = 2;
/** "3rd session" from the brief. */
export const SESSION_TRIGGER = 3;
/** "5+ sightings in one session" from the brief. See `viewActions` below. */
export const VIEW_ACTION_TRIGGER = 5;

export const DISMISS_SNOOZE_DAYS = 14;
/**
 * A donate click snoozes far longer than a dismissal. Someone who has just given
 * should not be asked again in two weeks. Same key, longer expiry — there is no
 * second flag that could disagree with this one.
 */
export const DONATED_SNOOZE_DAYS = 365;

// ─── Pure policy ─────────────────────────────────────────────────────────────

export interface SessionState {
  count: number;
  /** When the most recent page load in this session happened. */
  lastStartMs: number;
}

/**
 * Advance the session counter for a page load at `now`.
 *
 * Anything unreadable — missing, wrong shape, non-finite, zero — restarts at
 * session 1, which suppresses the prompt. This is the **opposite** of
 * lib/onboarding.ts's choice, deliberately: a spurious extra intro modal is
 * recoverable, a spurious extra request for money is not.
 *
 * A clock that has moved backwards produces a negative elapsed time, which falls
 * under the gap and therefore does *not* advance the counter. Conservative in the
 * same direction as everything else here.
 */
export function nextSessionState(prev: SessionState | null, now: number): SessionState {
  if (
    !prev ||
    !Number.isFinite(prev.count) ||
    !Number.isFinite(prev.lastStartMs) ||
    prev.count < 1
  ) {
    return { count: 1, lastStartMs: now };
  }
  if (now - prev.lastStartMs < SESSION_GAP_MS) {
    return { count: prev.count, lastStartMs: now };
  }
  return { count: prev.count + 1, lastStartMs: now };
}

export interface PromptInputs {
  sessionCount: number;
  /**
   * Distinct *view actions* this session — not distinct birds.
   *
   * The brief says "viewing 5+ sightings". Two different gestures in this app mean
   * that: opening a location's detail panel from a map marker, and focusing a
   * species from an Alerts-list card. They are keyed in different namespaces
   * (`loc:` / `sp:`) because they identify different objects — a marker group is a
   * place holding many species, a focus is one species across many places — so a
   * single Set cannot collapse them onto one entry, and a user who taps a pin and
   * then the same bird in the list scores 2.
   *
   * That is intended and it is why this field is not called `sightingsViewed`:
   * they are two genuinely different engagement signals, and five deliberate acts
   * of looking at something is the bar the brief is reaching for. Do not "fix"
   * the double count by unifying the keys without also raising the threshold.
   */
  viewActions: number;
  snoozedUntilMs: number;
  now: number;
}

/**
 * The whole policy, in one expression.
 *
 * The first-session rule is checked FIRST and independently of the triggers, so a
 * session-1 user who views twenty sightings still sees nothing. Folding it into
 * the trigger expression is how "never during the first session" quietly becomes
 * "usually not during the first session".
 */
export function shouldShowDonationPrompt({
  sessionCount,
  viewActions,
  snoozedUntilMs,
  now,
}: PromptInputs): boolean {
  if (!Number.isFinite(sessionCount) || sessionCount < MIN_SESSION_FOR_PROMPT) return false;
  if (now < snoozedUntilMs) return false;
  return sessionCount >= SESSION_TRIGGER || viewActions >= VIEW_ACTION_TRIGGER;
}

// ─── Storage ─────────────────────────────────────────────────────────────────
//
// Same conventions as lib/lifelist.ts and lib/onboarding.ts: a `birdradar_` key,
// every read and write wrapped, and nothing thrown into a React state update from
// a quota failure or a restricted private-browsing context.

const SESSION_KEY = 'birdradar_sessions';
const SNOOZE_KEY = 'birdradar_donate_snooze';

/**
 * Record this page load and return the session ordinal.
 *
 * Returns 0 on the server, which fails `MIN_SESSION_FOR_PROMPT` — the banner can
 * never be in the SSR payload. Like `hasSeenOnboarding()`, this must be called
 * from a mount effect and never a `useState` initializer: hydration re-runs
 * initializers on the client, where `window` exists, and the mismatched tree gets
 * discarded (see the note in lib/onboarding.ts).
 */
export function startSession(now: number = Date.now()): number {
  if (typeof window === 'undefined') return 0;

  let prev: SessionState | null = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object') {
        const { count, lastStartMs } = parsed as Partial<SessionState>;
        if (typeof count === 'number' && typeof lastStartMs === 'number') {
          prev = { count, lastStartMs };
        }
      }
    }
  } catch {
    prev = null; // unparseable reads as "no sessions yet" — see nextSessionState
  }

  const next = nextSessionState(prev, now);
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // Quota / restricted context. The counter stops advancing, so the prompt
    // simply never fires. That is the acceptable direction of failure.
  }
  return next.count;
}

/**
 * Timestamp the prompt is suppressed until; 0 when it has never been dismissed.
 *
 * Both failure paths suppress rather than ask. A corrupt value is treated as a
 * fresh dismissal, so it self-heals after `DISMISS_SNOOZE_DAYS` instead of
 * suppressing forever; unreadable storage suppresses outright, because there is
 * nowhere to write a dismissal to and the prompt would otherwise return on every
 * single load with no way for the user to stop it.
 */
export function getSnoozedUntil(now: number = Date.now()): number {
  if (typeof window === 'undefined') return Number.POSITIVE_INFINITY;
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : now + DISMISS_SNOOZE_DAYS * DAY_MS;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function snoozeDonation(days: number, now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SNOOZE_KEY, String(now + days * DAY_MS));
  } catch {
    // The banner reappears next session, which is a nuisance rather than a fault.
  }
}

// ─── Event names ─────────────────────────────────────────────────────────────
// The three events named in the brief, in one place so a typo at a call site is a
// type error rather than a metric that silently never arrives.

export const DONATION_EVENTS = {
  shown: 'donation_prompt_shown',
  clicked: 'donation_prompt_clicked',
  dismissed: 'donation_prompt_dismissed',
} as const;
