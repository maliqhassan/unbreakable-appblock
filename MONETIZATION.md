# Monetization — Free / Pro

Android only. Everything here is RevenueCat + Google Play + AdMob.

| | Free | Pro — **$2.99 / month** |
| --- | --- | --- |
| Blocked apps | 1 | Multiple |
| Max lock duration | 60 minutes | 24 hours |
| Strict Mode | — | ✓ |
| Advertisements | Shown | **Never** |

---

## Architecture

```
Screens
   │  useSubscription()          ← the ONLY entitlement entry point
   ▼
useUserStore (zustand)           ← shared cache
   │
   ▼
PurchaseService                  ← the only file that imports RevenueCat
   │
   ▼
RevenueCat  ─────────────────►  THE SOURCE OF TRUTH
```

No screen imports `react-native-purchases`. No screen reads a tier from storage.
Adding user accounts later means changing `PurchaseService.configure()` to call
`Purchases.logIn(userId)` — nothing else in the app moves.

**There is no registration, no login, and no backend.** RevenueCat's anonymous
customer identity is used throughout.

### Entitlement is never invented

`AsyncStorage` caches the last known entitlement so the first frame after launch
has something to render — a paying user must never see a paywall flash while a
network request completes. That cache **never grants** anything:

- A fresh RevenueCat read always overrides it.
- It is only *trusted* when RevenueCat is unreachable.
- With no successful read ever, status is `unknown`, not `PRO`.

### Cancellation does not revoke access

This is the subtlety worth stating plainly. RevenueCat keeps an entitlement in
`entitlements.active` until the paid period genuinely ends, so:

| RevenueCat state | Our status | Is the user Pro? |
| --- | --- | --- |
| Active, auto-renew on | `active` | **Yes** |
| Auto-renew turned off, period not over | `cancelled` | **Yes** — they paid for it |
| Payment failed, still in grace period | `billingIssue` | **Yes** |
| Period ended | `expired` | No |
| Never subscribed | `free` | No |

Taking Pro away the moment someone turns off auto-renew would be taking back
something already paid for. The subscription screen explains the state instead.

### Offline

`getCustomerInfo()` returns the last known state on network failure, never
`FREE`. A tunnel, a flaky connection, or a RevenueCat outage does not downgrade
a customer.

---

## Google Play Console setup

Play products cannot be created from code. Do this once in the console.

1. **Create the app** with package `com.unbreakablelock.app`.
2. **Monetize → Subscriptions → Create subscription**
   - Product ID: `unbreakable_lock_pro`
   - Name: `Unbreakable Lock Pro`
3. **Add a base plan**
   - Base plan ID: `pro-monthly`
   - Type: **Auto-renewing**
   - Billing period: **1 month**
   - Price: **$2.99 USD** (set other regions as you like)
   - Renewal type: Auto-renewing
4. **Activate** the base plan. A draft plan is invisible to the SDK.
5. **Upload a build** to at least Internal testing. Play will not serve
   subscriptions to an app it has never seen.

These ids are mirrored in `src/constants/limits.ts` as `PLAY_SUBSCRIPTION_ID`
and `PLAY_BASE_PLAN_MONTHLY`. Change both together.

### Licence testers (test purchases without paying)

1. **Play Console → Setup → Licence testing**
2. Add the Google accounts that will test.
3. Those accounts see "Test card, always approves" at checkout and are not
   charged. Subscriptions renew every few minutes instead of monthly, so a full
   renew/cancel/expire cycle can be exercised in an afternoon.
4. The tester must be signed into that Google account **on the device**.

Test purchases come back with `isSandbox: true` and the subscription screen
labels them as test purchases.

---

> Step-by-step store configuration, including regional pricing and country
> availability, lives in **[REVENUECAT_SETUP.md](REVENUECAT_SETUP.md)**.

## RevenueCat setup

1. Create a project at <https://app.revenuecat.com>.
2. **Add an app** → Google Play → package `com.unbreakablelock.app`.
3. Upload the **Play service-account JSON** so RevenueCat can validate
   purchases. (Play Console → Setup → API access → create a service account with
   *Financial data* + *Manage orders and subscriptions*.)
4. **Products → Import** the `unbreakable_lock_pro:pro-monthly` product.
5. **Entitlements → Create** an entitlement with identifier exactly:

   ```
   pro
   ```

   Attach the product to it. This string is `ENTITLEMENT_PRO` in
   `src/constants/limits.ts`; if you change one, change both.
6. **Offerings → Default offering** → add the product as the **Monthly**
   package. The app reads `offerings.current.monthly`.
7. Copy the **Android public SDK key** into `.env`:

   ```bash
   EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_xxxxxxxxxxxx
   ```

This is a *publishable* key. It is designed to ship in the client bundle and is
not a secret. The Play service-account JSON **is** a secret and lives only in
RevenueCat — never in this repo.

---

## AdMob setup

1. Create an app at <https://apps.admob.com> for package
   `com.unbreakablelock.app`.
2. Create an **Ad unit → Banner**.
3. Put both ids in `.env`:

   ```bash
   EXPO_PUBLIC_ADMOB_ANDROID_APP_ID=ca-app-pub-XXXXXXXX~XXXXXXXX
   EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID=ca-app-pub-XXXXXXXX/XXXXXXXX
   ```
4. The **app id** is compiled into `AndroidManifest.xml`, so changing it needs:

   ```bash
   npx expo prebuild -p android --clean
   ```

   The **banner id** is read at runtime and only needs a JS reload.

### Test ids are the default

With both variables empty, the app uses Google's published test ids. That is
deliberate: a build that forgets to configure ads shows test ads rather than
risking a policy strike for serving live ads in development.

⚠️ **Never point a development build at production ad ids.** Clicking your own
live ads is an AdMob policy violation that can get the account terminated.

### Where ads appear — and do not

**Shown:** the Home / app-selection screen, above the primary button.

**Never shown:**

- the Active Lock screen
- the native block screen (`BlockActivity`)
- any permission or onboarding flow
- the subscription screen

A stray tap near enforcement UI could interrupt a lock, which is the one thing
an ad must never do. The entitlement check lives *inside* `AdBanner` with no
prop to override it, so no screen can accidentally show an ad to a Pro user.

Pro users never initialise the AdMob SDK at all — `AdBanner` returns `null`
before it would load anything.

---

## The `useSubscription()` hook

The only entitlement API the rest of the app uses:

```ts
const {
  isPro,
  isLoading,
  tier,          // 'FREE' | 'PRO'
  status,        // 'active' | 'cancelled' | 'billingIssue' | 'expired' | ...
  subscription,  // full detail: expiry, willRenew, managementUrl, isSandbox
  limits,        // TierLimits for this user — never re-derive these
  showAds,
  priceString,
  purchasePro,
  restorePurchases,
  refresh,
} = useSubscription();
```

Gating rules live in `FREE_LIMITS` / `PRO_LIMITS` in `src/constants/limits.ts`
and are enforced by `LockService.validateConfiguration()`. No screen hardcodes
"1 app" or "60 minutes".

---

## Manage subscription

Cancellation is **not** implemented in-app. Google requires it to go through
Play, and a homegrown flow would be non-compliant.

The Pro view links to `customerInfo.managementURL` from RevenueCat. When that is
missing — which happens for simulated and some restored purchases — the app
shows directions to *Play Store → Menu → Payments & subscriptions → Subscriptions*
rather than dead-ending.

---

## Release checklist

- [ ] `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` set to the real key
- [ ] `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID` and `..._BANNER_ID` set to real ids
- [ ] `EXPO_PUBLIC_DEV_PRO_MODE=false`
- [ ] `npx expo prebuild -p android --clean` after changing the AdMob app id
- [ ] Subscription screen shows **no** "Development mode" notice
- [ ] Test purchase completes with a Play licence tester
- [ ] Restore works on a second device with the same Google account
- [ ] Ads visible on Free, absent on Pro
- [ ] Signed with your own upload keystore, not the debug key
- [ ] AdMob app-ads.txt published if you use it

---

## What is deliberately absent

- **No backend.** Nothing to run, nothing to breach.
- **No accounts, no email, no password.** RevenueCat anonymous identity only.
- **No receipt validation of our own.** RevenueCat does it against Play.
- **No custom cancellation.** Play owns that.
- **No ad personalisation.** `requestNonPersonalizedAdsOnly: true`.
