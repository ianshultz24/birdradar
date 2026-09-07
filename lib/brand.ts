/**
 * The product name, in one place.
 *
 * This exists because `lib/ops/maintenance-page.ts` renders a complete HTML
 * document that has to survive a rename without anyone remembering to open it.
 * The maintenance page is the *least* frequently edited file in the repo and the
 * most publicly visible one when it renders, which is the worst combination for
 * a hard-coded string.
 *
 * ─── Scope, deliberately ─────────────────────────────────────────────────────
 *
 * Only `lib/ops/maintenance-page.ts` and the `/dev` panel read this. The ~20
 * other "BirdRadar" literals in the repo — app/layout.tsx:33,35,
 * app/manifest.ts:5-6, components/Sidebar.tsx:268, OnboardingModal,
 * SettingsPanel, DonationBanner — keep their literals on purpose. Sweeping them
 * would fold a rename refactor into a developer-mode change and make both harder
 * to review, and it would not even finish the job: `public/sw.js` is plain
 * JavaScript served from `public/` and cannot import a module at all.
 *
 * When the rename happens it gets its own commit.
 */

export const BRAND = 'BirdRadar';

/** Where a user lands when the app is down and they still need a human. */
export const SUPPORT_EMAIL = 'ianshultz24@gmail.com';

/** The organisation the project supports. Kept beside the brand because the
 *  maintenance page names both and neither should be retyped there. */
export const PARTNER_NAME = 'Eastside Audubon';
export const PARTNER_URL = 'https://eastsideaudubon.org';
