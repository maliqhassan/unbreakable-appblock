/* eslint-disable no-undef */

// AsyncStorage ships an official in-memory mock; the store and services are
// tested against it rather than against a hand-rolled fake.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The native module is absent under Jest, which is the point: the tests
// exercise the same fallback path a JS-only environment takes.
jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  requireOptionalNativeModule: () => null,
}));

// react-native-purchases has no JS-only build; PurchaseService already handles
// it being missing, and this keeps the require() from resolving a native stub.
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    getCustomerInfo: jest.fn(async () => ({ entitlements: { active: {} } })),
    getOfferings: jest.fn(async () => ({ current: null })),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(async () => ({ entitlements: { active: {} } })),
  },
  LOG_LEVEL: { WARN: 'WARN' },
}));

// AdMob has no JS-only build. AdService already tolerates it being missing;
// this keeps the require() from resolving a native stub under Jest.
jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  default: () => ({ initialize: jest.fn(async () => []) }),
  BannerAd: () => null,
  BannerAdSize: { ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER' },
  TestIds: { BANNER: 'ca-app-pub-3940256099942544/6300978111' },
}));

// Firebase and Google Sign-In are network/native services. AuthService already
// tolerates them being absent; these mocks keep require() from resolving a
// native stub and make the "not configured" path deterministic.
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(() => ({})),
  getApps: jest.fn(() => []),
  getApp: jest.fn(() => ({})),
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({ data: { idToken: 'test-id-token' } })),
    signOut: jest.fn(async () => undefined),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));
