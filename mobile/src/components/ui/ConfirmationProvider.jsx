import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { BottomSheet, Button, Text } from './index';
const ConfirmationContext = createContext((...args) => Alert.alert(...args));
export function ConfirmationProvider({ children }) {
 const [request, setRequest] = useState(null); const used = useRef(false);
 const confirm = useCallback((title, message, actions = []) => { used.current = false; setRequest({ title, message, actions }); }, []);
 const choose = action => { if (used.current) return; used.current = true; setRequest(null); action?.onPress?.(); };
 return <ConfirmationContext.Provider value={confirm}>{children}<BottomSheet visible={!!request} title={request?.title} onClose={() => choose(request?.actions.find(a => a.style === 'cancel'))}><Text>{request?.message}</Text>{request?.actions.filter(a => a.style !== 'cancel').map((action, index) => <Button key={index} label={action.text || 'Continue'} variant={action.style === 'destructive' ? 'danger' : 'primary'} onPress={() => choose(action)} />)}</BottomSheet></ConfirmationContext.Provider>;
}
export const useConfirmation = () => useContext(ConfirmationContext);
