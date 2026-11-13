import { createContext, useContext, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useTheme } from '../../theme/ThemeProvider';
import { EmptyState } from './index';
const Navigation = createContext(null);
export function usePaneRouter() {
 const router = useRouter(); const pane = useContext(Navigation);
 return useMemo(() => !pane ? router : { ...router, push: route => { if (typeof route === 'object' && route.pathname === pane.route) pane.select(route.params); else router.push(route); }, back: () => pane.detail ? pane.select(null) : router.back(), canGoBack: () => pane.detail || router.canGoBack() }, [router, pane]);
}
export function usePaneParams() { const params = useLocalSearchParams(); const pane = useContext(Navigation); return pane?.detail ? pane.params : params; }
export default function MasterDetail({ route, master, renderDetail }) {
 const { compact } = useBreakpoint(); const { colors } = useTheme(); const [params, select] = useState(null);
 if (compact) return master;
 return <View style={{ flex: 1, flexDirection: 'row', maxWidth: 1280, width: '100%', alignSelf: 'center' }}><Navigation.Provider value={{ route, select, detail: false }}><View style={{ flex: 1, borderRightWidth: 1, borderRightColor: colors.border }}>{master}</View></Navigation.Provider><View style={{ flex: 1.6 }}><Navigation.Provider value={{ route, select, params, detail: true }}>{params ? renderDetail() : <EmptyState title="Select an item" message="Details appear here. Your list stays available." />}</Navigation.Provider></View></View>;
}
