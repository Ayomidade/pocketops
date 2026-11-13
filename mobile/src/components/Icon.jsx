import Svg, { Path } from "react-native-svg";
import { useTheme } from "../theme/ThemeProvider";
const paths = {
  branch: "M6 3v12a3 3 0 1 0 3 3M6 7c0 5 12 2 12 7v4M16 3h4v4h-4Z",
  commit: "M3 12h5m8 0h5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  pr: "M6 3v18M12 5h3a3 3 0 0 1 3 3v13m-6-19-3 3 3 3",
  issue: "M12 8v5m0 3v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  clock: "M12 6v6l4 3M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  search: "m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  filter: "M3 5h18M6 12h12m-9 7h6", copy: "M8 8h13v13H8ZM3 16V3h13",
  check: "m4 12 5 5L20 6", x: "m5 5 14 14M19 5 5 19", chevron: "m9 5 7 7-7 7",
  external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7", settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-7 0v6",
  bell: "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Zm5 3h4",
  alert: "m12 3 10 18H2ZM12 9v5m0 3v1", more: "M4 12h1m6 0h1m6 0h1",

  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  repo: "M5 3h14v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 14h14M8 7h7",
  deploy: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  incident: "m12 3 10 18H2ZM12 9v5m0 3v1",
  profile: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  back: "m14 5-7 7 7 7",
  folder: "M3 5h7l2 3h9v12H3Z",
  file: "M5 3h9l5 5v13H5ZM14 3v6h5",
};
export default function Icon({
  name,
  color,
  size = 22,
}) {
  const { colors } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={paths[name] || paths.file}
        fill="none"
        stroke={color || colors.textSecondary}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
