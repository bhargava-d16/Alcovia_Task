// Design tokens — single source of truth for the entire app
// Mirrors the spec exactly. Import from here, never hardcode values.

export const Colors = {
  primary: '#1A56DB',
  surface: '#F8F9FF',
  accent: '#F59E0B',
  success: '#10B981',
  danger: '#EF4444',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  card: '#FFFFFF',
  border: 'rgba(0,0,0,0.08)',
  // Status border colors for cards
  statusActive: '#1A56DB',
  statusSuccess: '#10B981',
  statusFailed: '#EF4444',
  // Background for offline indicator
  offline: '#94A3B8',
};

export const Radii = {
  card: 12,
  button: 8,
  input: 8,
  pill: 20,
  chip: 20,
};

export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
};

export const Typography = {
  heading1: { fontSize: 28, fontWeight: '600' as const, color: Colors.textPrimary },
  heading2: { fontSize: 22, fontWeight: '600' as const, color: Colors.textPrimary },
  heading3: { fontSize: 18, fontWeight: '600' as const, color: Colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400' as const, color: Colors.textPrimary },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, color: Colors.textSecondary },
  label: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.8 },
  timer: { fontSize: 56, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as const },
  coin: { fontSize: 20, fontWeight: '600' as const, color: Colors.accent },
};

export const API_BASE = 'http://localhost:4000/api/v1';
