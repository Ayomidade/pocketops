import { View } from 'react-native';
import { Button, Text, Banner } from '../../src/components/ui';
import Icon from '../../src/components/Icon';
import RemoteState from '../../src/components/RemoteState';
import Screen from '../../src/components/Screen';
import { useAuth } from '../../src/features/auth/AuthProvider';
export default function LoginPage() {
 const { status, message, beginGithubLogin, cancelGithubLogin, restoreSession } = useAuth();
 const pending = ['starting','awaiting_callback','exchanging'].includes(status);
 return <Screen title="PocketOps" subtitle="Your operations, wherever you are."><View style={{ alignItems: 'center', gap: 16, paddingVertical: 32 }}><Icon name="repo" size={48} /><Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '600' }}>Welcome to PocketOps</Text><Text style={{ textAlign: 'center' }}>Investigate incidents. Review code. Stay in control.</Text></View>
 {message ? <Banner tone="warning">{message}</Banner> : null}
 {pending ? <RemoteState kind="loading" title={status === 'exchanging' ? 'Completing sign-in...' : status === 'starting' ? 'Please wait...' : 'Waiting for GitHub...'} /> : <Button label="Continue with GitHub" variant="primary" onPress={() => void beginGithubLogin()} />}
 {status === 'awaiting_callback' ? <Button label="Cancel GitHub sign-in" variant="ghost" onPress={() => void cancelGithubLogin()} /> : null}
 {status === 'failed' ? <Button label="Retry restoring your session" onPress={() => void restoreSession()} /> : null}
 <Text style={{ fontSize: 13, textAlign: 'center' }}>Sign-in verifies your identity. You choose repository access separately.</Text>
 </Screen>;
}
