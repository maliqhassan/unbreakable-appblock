# RevenueCat + Google Play Setup

Everything needed to take Unbreakable Lock Pro from "simulated locally" to
"charging real money in the user's own currency".

Work through it in order — Play Console first, then RevenueCat, then the app —
because each stage needs an identifier created in the one before it.

> **Division of responsibility.** Google Play is the **payment** authority: it
> owns the checkout sheet, the money, the currency and the refund. RevenueCat is
> the **entitlement** authority: it answers "is this user Pro right now?". The
> app implements neither. It never computes a price, never converts a currency,
> and never decides on its own that someone is subscribed.

---

## 0. Identifiers this app expects

These are compiled into the app, in [src/constants/limits.ts](src/constants/limits.ts).
Create them with **exactly** these ids, or change the constants and rebuild — a
mismatch fails silently as "Pro is temporarily unavailable".

| Thing | Id | Created in |
| --- | --- | --- |
| Subscription product | `unbreakable_lock_pro` | Play Console |
| Base plan (monthly) | `pro-monthly` | Play Console |
| Entitlement | `pro` | RevenueCat |
| Offering | `default` | RevenueCat |
| Package | `$rc_monthly` | RevenueCat |

---

## 1. Google Play Console

### 1.1 Prerequisites

- A Play Console developer account with the **payments profile** linked
  (Play Console → Setup → Payments profile). Without it the subscription page
  will not let you set prices.
- The app created, with package name `com.unbreakablelock.app`.
- **At least one build uploaded to a track** (internal testing is enough). Play
  will not show in-app products for an app that has never been uploaded, and the
  Billing Library must be present in that build — it is, via
  `react-native-purchases`.

### 1.2 Create the subscription

Play Console → Monetize → **Subscriptions** → Create subscription.

- **Product ID:** `unbreakable_lock_pro` — permanent. It can never be edited or
  reused after creation, so type it carefully.
- **Name:** `Unbreakable Lock Pro` (30 characters max, shown at checkout).
- **Benefits:** up to four short lines. Keep them factual and matched to
  `PRO_BENEFITS` in [src/constants/limits.ts](src/constants/limits.ts):
  unlimited apps, daily usage limits, recurring schedules, Strict Mode, no ads.

Save. The subscription exists but sells nothing until it has a base plan.

### 1.3 Create the base plan

Inside the subscription → **Add base plan**.

- **Base plan ID:** `pro-monthly` — also permanent.
- **Type:** Auto-renewing.
- **Billing period:** Monthly (P1M).
- **Grace period:** 7 days recommended. This is what makes a failed card a
  recoverable `billingIssue` rather than an instant downgrade — the app already
  keeps such users on Pro (see `stateFromCustomerInfo` in
  [src/services/PurchaseService.ts](src/services/PurchaseService.ts)).
- **Account hold:** leave enabled (default).
- **Free trial / intro offer:** optional. If you add one, RevenueCat and the app
  need no changes — Play returns the offer price in the same `priceString` the
  app already renders.

### 1.4 Regional pricing — the part that matters

This is where a user in Karachi is charged in PKR and a user in Berlin in EUR,
without a single line of app code.

In the base plan → **Set prices**:

1. Set the price for your anchor market first (for example USD 2.99).
2. Choose **Set prices for other countries** and let Play **auto-convert**. Play
   uses live exchange rates, applies local tax rules, and rounds to a locally
   sensible figure (₨ 850, ¥400, R$ 14,90 — not a raw conversion).
3. Review the table. Any country can be overridden individually; Play remembers
   manual overrides and will not auto-convert them again.
4. Consider **purchasing-power pricing** in markets where a straight conversion
   is expensive relative to local income. Play surfaces suggestions for this.

**Availability:** the subscription → *Countries/regions*. Select every market you
intend to sell in. An unavailable country is the most common cause of "the price
will not load" reports from real users.

> ⚠️ **Never hardcode a price in the app.** There is deliberately no fallback
> price constant in this codebase, and the reason is written into
> [limits.ts](src/constants/limits.ts): a hardcoded figure is wrong for most of
> the world, and if it ever disagreed with the Play checkout sheet the user would
> be quoted one price and charged another.
>
> ⚠️ **Never infer a country from the developer's location, the SIM, or the IP
> address.** The app does none of these. Google Play already knows which country
> the user's Play account is registered to, and prices from that. The developer
> being in Pakistan says nothing about where any user is.

### 1.5 Activate

Activate the base plan. It stays inactive — and invisible to the SDK — until you
do.

---

## 2. RevenueCat

### 2.1 Project and app

1. Create a project at [app.revenuecat.com](https://app.revenuecat.com).
2. Add an app: platform **Google Play**, package `com.unbreakablelock.app`.

### 2.2 Play service-account credentials

RevenueCat needs read access to your Play subscriptions in order to validate
purchases.

1. Google Cloud Console → the project behind your Play account → IAM & Admin →
   Service Accounts → create one.
2. Grant it access in **Play Console → Users and permissions**, with *View
   financial data* and *Manage orders and subscriptions*.
3. Create a JSON key and upload it **to the RevenueCat dashboard**.

> 🔒 That JSON key is a real secret. It goes to RevenueCat's dashboard and
> nowhere else. **Never** commit it to this repository, put it in `.env`, or
> bundle it into the APK — anything shipped in an APK is readable by anyone who
> downloads the APK.

Play can take up to 36 hours to propagate service-account permissions. Purchases
may fail validation until it does; this is normal and needs no code change.

### 2.3 Entitlement

Entitlements → Create → identifier **`pro`**.

This single string is what the whole app gates on. `PurchaseService` reads
`customerInfo.entitlements.active['pro']` and nothing else.

### 2.4 Product

Products → Import / Add → select the Play product:

- Product id: `unbreakable_lock_pro:pro-monthly`
  (RevenueCat addresses a Play base plan as `product:base-plan`.)

Attach it to the `pro` entitlement.

### 2.5 Offering and package

Offerings → Create:

- **Offering identifier:** `default`, and mark it **Current**. The app reads
  `offerings.current`, so a non-current offering is invisible to it.
- **Package:** add one with identifier `$rc_monthly` (RevenueCat's standard
  monthly package), containing the product above.

The app resolves the package defensively — `offerings.current.monthly`, then a
lookup by `$rc_monthly`, then the first available package — so a slightly
different package id still works. The offering being *current* is the part that
is not optional.

### 2.6 Public SDK key

Project settings → API keys → copy the **Google Play public SDK key** (`goog_…`).

There are two kinds of key. The public SDK key is *designed* to ship in a client
binary. The **secret key** (`sk_…`) can read and modify any customer's
subscription and must never be in the app, the repo, or a CI log — it belongs
only in server-side code, and this app has no server.

---

## 3. The app

Add the public key to `.env` (untracked; see [.env.example](.env.example)):

```
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_xxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_DEV_PRO_MODE=false
```

Then rebuild. `.env` is **not** a tracked Gradle input, so a rebuild can quietly
reuse the previous JS bundle:

```bash
rm -rf android/app/build/generated/assets/react \
       android/app/build/intermediates/assets/release
npx expo run:android --variant release
```

Verify the key actually made it into the bundle:

```bash
unzip -p android/app/build/outputs/apk/release/app-release.apk \
  assets/index.android.bundle | grep -c goog_
```

With no key configured the app runs in **simulated billing**: Pro can be toggled
locally, the subscription screen says plainly that no payment was taken, and no
real purchase is ever possible. That is the correct state for development.

---

## 4. Testing a real purchase

Automated tests cover the app's side of this — price rendering, cancellation,
failure, restore, entitlement mapping. They **cannot** cover Google Play billing
itself, which requires a signed build installed from a Play track on a physical
device with a real Play account.

1. Play Console → Setup → **License testing** → add the tester's Gmail address.
   Licence testers see real checkout sheets but are never charged, and test
   subscriptions renew in minutes rather than months.
2. Upload the release build to **internal testing** and install it *from the Play
   link*, not by sideloading the APK. A sideloaded build cannot query Play
   Billing, and the price will show as unavailable.
3. Check, on the device:
   - the Subscription screen shows a price in the tester's own currency;
   - buying it flips the app to Pro without a restart;
   - cancelling the sheet leaves the user on Free with no error dialog;
   - "Restore" recovers Pro after a reinstall;
   - ads disappear for Pro and appear for Free;
   - cancelling the subscription in Play keeps Pro until the period ends.
4. To check another region, use a Play account registered to that country. The
   app needs no change — a different `priceString` simply arrives.

---

## 5. Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Pro is temporarily unavailable" | No current offering, base plan inactive, or the country is not in the availability list. |
| Price loads in debug but not release | Build installed by sideload rather than from a Play track. |
| Purchase succeeds, app stays Free | The product is not attached to the `pro` entitlement in RevenueCat. |
| Purchases fail validation for a day | Play service-account permissions still propagating (up to 36 h). |
| Price shows in an unexpected currency | Expected — it follows the *Play account's* country, not the device locale or SIM. |

---

## See also

- [MONETIZATION.md](MONETIZATION.md) — how the Free/Pro split is implemented in
  the app, `useSubscription()`, and the AdMob setup.
- [src/constants/limits.ts](src/constants/limits.ts) — the single source of truth
  for tier limits and store identifiers.
