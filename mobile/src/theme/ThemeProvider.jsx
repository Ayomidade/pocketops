import { createContext, useContext, useMemo, useState } from 'react';
import { View, useColorScheme } from 'react-native';
import { vars } from 'nativewind';
import { themes } from './tokens';
const ThemeContext = createContext({ mode: 'system', scheme: 'dark', colors: themes.dark, setMode: () => {} });
export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [mode, setMode] = useState('system');
  const scheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  const colors = themes[scheme];
  const variables = useMemo(() => vars(Object.fromEntries(Object.entries(colors).map(([key, hex]) => [`--color-${key}`, hex.slice(1).match(/../g).map(n => parseInt(n, 16)).join(' ')]))), [colors]);
  return <ThemeContext.Provider value={{ mode, setMode, scheme, colors }}><View style={[{ flex: 1, backgroundColor: colors.bg }, variables]}>{children}</View></ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
