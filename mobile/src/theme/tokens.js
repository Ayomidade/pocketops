// Single palette source for NativeWind, native components and the isolated editor.
const dark = {
  bg: '#0D1117', surface: '#161B22', surfaceHi: '#21262D', border: '#30363D',
  textPrimary: '#E6EDF3', textSecondary: '#9DA7B3', textMuted: '#9DA7B3', textMutedReadable: '#9DA7B3',
  accent: '#1F6FEB', accentHi: '#58A6FF', primary: '#238636', primaryHover: '#2EA043', textOnAccent: '#FFFFFF',
  critical: '#F85149', warning: '#D9A441', success: '#3FB950', info: '#79C0FF', neutral: '#9DA7B3', done: '#BC8CFF',
  diffAdded: '#86EFAC', diffRemoved: '#FCA5A5', diffAddedBg: '#123126', diffRemovedBg: '#3A2029',
};
const light = {
  bg: '#FFFFFF', surface: '#F6F8FA', surfaceHi: '#EAEEF2', border: '#D0D7DE',
  textPrimary: '#1F2328', textSecondary: '#59636E', textMuted: '#59636E', textMutedReadable: '#59636E',
  accent: '#0969DA', accentHi: '#095CBF', primary: '#1F7A37', primaryHover: '#1A6D30', textOnAccent: '#FFFFFF',
  critical: '#B62324', warning: '#795600', success: '#166B2C', info: '#095CBF', neutral: '#59636E', done: '#7540B3',
  diffAdded: '#166B2C', diffRemoved: '#B62324', diffAddedBg: '#DAFBE1', diffRemovedBg: '#FFEBE9',
};
const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
const layout = { content: 720, shell: 1280, compact: 600, expanded: 1024, touch: 48 };
const typography = { caption: 12, body: 15, subtitle: 16, title: 20, screen: 24 };
const radii = { control: 6, card: 12 };
const statusTone = { low: 'neutral', medium: 'warning', high: 'critical', critical: 'critical', open: 'critical', investigating: 'info', mitigating: 'warning', monitoring: 'info', resolved: 'success', live: 'success', building: 'info', queued: 'warning', requested: 'info', failed: 'critical', canceled: 'neutral', unknown: 'neutral', active: 'success', disconnected: 'neutral' };
module.exports = { colors: dark, themes: { dark, light }, spacing, layout, typography, radii, statusTone };
