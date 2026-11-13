import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text, IconButton } from './ui';
import { useTheme } from '../theme/ThemeProvider';
export default function AppHeader({ title, subtitle, onBack, action }) {
  const router = useRouter(); const { colors } = useTheme();
  return <View style={{ paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{onBack ? <IconButton icon="back" label="Back" onPress={onBack} /> : null}<Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ flex: 1, fontSize: 24, fontWeight: '600' }}>{title}</Text>{action}<IconButton icon="profile" label="Account and settings" onPress={() => router.push('/(tabs)/settings')} /></View>{subtitle ? <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 4 }}>{subtitle}</Text> : null}</View>;
}
