import { useState } from 'react';
import { useRouter } from 'expo-router';
import Screen from '../../src/components/Screen';
import { Text, Card, SectionHeader, FilterChips, ListRow, Button, BottomSheet } from '../../src/components/ui';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/features/auth/AuthProvider';
export default function Page() {
 const router = useRouter(); const { user, logout, message } = useAuth(); const { mode, setMode } = useTheme(); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
 return <Screen title="Settings" onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
  <Card title={user?.username || 'Account'} description={user?.email || 'Signed in with GitHub'} />
  <SectionHeader title="Appearance" /><FilterChips label="Theme" values={['system','light','dark']} value={mode} onChange={setMode} />
  <SectionHeader title="Connections" /><ListRow icon="repo" title="GitHub" meta="Accounts and selected repositories" onPress={() => router.push('/connections')} /><ListRow icon="deploy" title="Render" meta="Connected services" onPress={() => router.push('/project/connections')} />
  <SectionHeader title="Preferences" /><ListRow icon="bell" title="Notifications" onPress={() => router.push('/incident/notifications')} />
  <SectionHeader title="About" /><Text>PocketOps · Native incident response</Text>
  {message ? <Text accessibilityRole="alert">{message}</Text> : null}
  <Button label="Sign out and revoke this session" variant="danger" onPress={() => setConfirm(true)} />
  <BottomSheet visible={confirm} title="Sign out of PocketOps?" onClose={() => !busy && setConfirm(false)}><Text>This revokes the current session. Save any unsaved work first.</Text><Button label="Confirm sign out" variant="danger" loading={busy} onPress={async () => { setBusy(true); try { await logout(); setConfirm(false); } catch { /* AuthProvider displays the safe error. */ } finally { setBusy(false); } }} /></BottomSheet>
 </Screen>;
}
