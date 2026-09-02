import type { Weekday } from '../types';

/**
 * Ready-made routines, offered on the empty schedules screen.
 *
 * Taken from how people actually describe their own days — "Sleep", "Work",
 * "Study" — rather than making them build a recurrence rule from parts. The
 * common case should be one tap plus choosing apps, not a form.
 *
 * These only seed the create screen; nothing is saved until the user saves it.
 */
export interface SchedulePreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  daysOfWeek: Weekday[];
  startTime: string;
  endTime: string;
  strictMode: boolean;
}

const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const EVERY_DAY: Weekday[] = [...WEEKDAYS, 'saturday', 'sunday'];

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: 'sleep',
    name: 'Sleep',
    icon: '🌙',
    description: 'Every day · 10 PM – 6 AM',
    daysOfWeek: EVERY_DAY,
    startTime: '22:00',
    endTime: '06:00',
    strictMode: false,
  },
  {
    id: 'work',
    name: 'Work',
    icon: '💼',
    description: 'Mon–Fri · 9 AM – 5 PM',
    daysOfWeek: WEEKDAYS,
    startTime: '09:00',
    endTime: '17:00',
    strictMode: false,
  },
  {
    id: 'study',
    name: 'Study',
    icon: '📚',
    description: 'Mon–Fri · 7 PM – 10 PM',
    daysOfWeek: WEEKDAYS,
    startTime: '19:00',
    endTime: '22:00',
    strictMode: true,
  },
  {
    id: 'detox',
    name: 'Digital Detox',
    icon: '🌱',
    description: 'Weekends · 9 AM – 6 PM',
    daysOfWeek: ['saturday', 'sunday'],
    startTime: '09:00',
    endTime: '18:00',
    strictMode: false,
  },
];

/** A stable icon for a saved schedule, matched by name where possible. */
export function iconForSchedule(name: string): string {
  const match = SCHEDULE_PRESETS.find(
    (preset) => preset.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (match) return match.icon;

  // Fall back on a keyword, so "Sleep time" still gets the moon.
  const lower = name.toLowerCase();
  if (lower.includes('sleep') || lower.includes('night')) return '🌙';
  if (lower.includes('work') || lower.includes('office')) return '💼';
  if (lower.includes('study') || lower.includes('school')) return '📚';
  if (lower.includes('detox') || lower.includes('break')) return '🌱';
  if (lower.includes('morning')) return '☀️';
  return '🔒';
}
