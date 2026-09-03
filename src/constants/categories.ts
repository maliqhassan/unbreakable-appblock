/**
 * Screen-time categories, and the colour each one owns.
 *
 * The ids match what `ScreenTimeQuery.kt` emits, which in turn comes from
 * Android's own `ApplicationInfo.category` — the developer's classification of
 * their own app, not a guess of ours.
 *
 * The palette is fixed rather than themed. A category colour is an identity:
 * Social has to be the same colour on the chart, in the list and on the Home
 * card, in light mode and dark, or the chart stops being readable at a glance.
 * These are chosen to stay legible on both a white card and a dark one.
 */

export interface Category {
  id: CategoryId;
  label: string;
  color: string;
}

export type CategoryId =
  | 'social'
  | 'entertainment'
  | 'games'
  | 'productivity'
  | 'news'
  | 'travel'
  | 'creativity'
  | 'other';

export const CATEGORIES: Record<CategoryId, Category> = {
  social: { id: 'social', label: 'Social', color: '#3B82F6' },
  entertainment: { id: 'entertainment', label: 'Entertainment', color: '#EF4444' },
  games: { id: 'games', label: 'Games', color: '#A855F7' },
  productivity: { id: 'productivity', label: 'Productivity', color: '#22C55E' },
  news: { id: 'news', label: 'News', color: '#F59E0B' },
  travel: { id: 'travel', label: 'Travel', color: '#06B6D4' },
  creativity: { id: 'creativity', label: 'Creativity', color: '#EC4899' },
  // Android's CATEGORY_UNDEFINED. Deliberately not guessed at — see
  // ScreenTimeQuery.kt. Grey, so it reads as "unsorted" rather than as a
  // category of its own.
  other: { id: 'other', label: 'Other', color: '#94A3B8' },
};

/** The order categories are listed in. Most-used first is decided at runtime. */
export const CATEGORY_ORDER: CategoryId[] = [
  'social',
  'entertainment',
  'games',
  'productivity',
  'news',
  'travel',
  'creativity',
  'other',
];

export function categoryFor(id: string): Category {
  return CATEGORIES[id as CategoryId] ?? CATEGORIES.other;
}
