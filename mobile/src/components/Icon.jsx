import Svg, { Path } from "react-native-svg";
import { colors } from "../theme/tokens";
const paths = {
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
  color = colors.textSecondary,
  size = 22,
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={paths[name] || paths.file}
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
