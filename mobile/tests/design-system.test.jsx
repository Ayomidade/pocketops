import { fireEvent, render } from '@testing-library/react-native';
import { Button, FilterChips, StatusPill, Text } from '../src/components/ui';
import { ConfirmationProvider, useConfirmation } from '../src/components/ui/ConfirmationProvider';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import MasterDetail from '../src/components/ui/MasterDetail';
import { usePaneRouter, usePaneParams } from '../src/components/ui/MasterDetail';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }), useLocalSearchParams: () => ({}) }));
jest.mock('../src/hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ compact: false }) }));
it('buttons preserve selected/checked semantics and prevent disabled actions', () => {
 const press = jest.fn(); const screen = render(<Button label="Choice" accessibilityRole="checkbox" accessibilityState={{ checked: true }} disabled onPress={press} />);
 expect(screen.getByRole('checkbox').props.accessibilityState.checked).toBe(true);
 fireEvent.press(screen.getByLabelText('Choice')); expect(press).not.toHaveBeenCalled();
});
it('statuses have text independent of their color', () => { const screen=render(<StatusPill value="critical" />); expect(screen.getByText(/critical/)).toBeTruthy(); });
it('theme changes retain mounted state and switch palette', () => {
 function Choice() { const { mode, colors, setMode } = useTheme(); return <><Text testID="palette">{colors.bg}</Text><FilterChips values={['light','dark']} value={mode} label="Theme" onChange={setMode} /></>; }
 const screen=render(<ThemeProvider><Choice /></ThemeProvider>); fireEvent.press(screen.getByLabelText('Theme: light')); expect(screen.getByTestId('palette').props.children).toBe('#FFFFFF'); fireEvent.press(screen.getByLabelText('Theme: dark')); expect(screen.getByTestId('palette').props.children).toBe('#0D1117');
});
it('wide selection opens authorized existing detail in a second pane without navigating away', () => {
 function Master() { const router=usePaneRouter(); return <Button label="Select repository" onPress={() => router.push({ pathname:'/repository/[id]',params:{id:'repo-b'} })} />; }
 function Detail() { const {id}=usePaneParams(); return <Text>{id}</Text>; }
 const screen=render(<MasterDetail route="/repository/[id]" master={<Master />} renderDetail={() => <Detail />} />);fireEvent.press(screen.getByLabelText('Select repository'));expect(screen.getByText('repo-b')).toBeTruthy();expect(screen.getByLabelText('Select repository')).toBeTruthy();expect(mockPush).not.toHaveBeenCalled();
});
it('confirmation does not run a mutation until explicitly accepted', () => {
 const mutation=jest.fn(); function Request() {const confirm=useConfirmation();return <Button label="Review" onPress={() => confirm('Confirm action','Exact resource',[{text:'Cancel',style:'cancel'},{text:'Approve',onPress:mutation}])} />;}
 const screen=render(<ConfirmationProvider><Request /></ConfirmationProvider>);fireEvent.press(screen.getByLabelText('Review'));expect(mutation).not.toHaveBeenCalled();fireEvent.press(screen.getByLabelText('Approve'));expect(mutation).toHaveBeenCalledTimes(1);
});
