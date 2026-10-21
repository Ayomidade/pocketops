import { Text, View } from "react-native";
export default function InfoCard({ title, description, badge }) {
  return (
    <View className="bg-panel border border-slate-700 rounded-2xl p-5 mb-4">
      <View className="flex-row justify-between items-center">
        <Text className="text-white font-semibold text-lg">{title}</Text>
        {badge ? <Text className="text-mint text-xs">{badge}</Text> : null}
      </View>
      <Text className="text-slate-400 mt-2 leading-6">{description}</Text>
    </View>
  );
}
