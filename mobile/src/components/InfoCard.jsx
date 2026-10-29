import { Text, View } from "react-native";
export default function InfoCard({ title, description, badge }) {
  return (
    <View className="bg-surface border border-border rounded-2xl p-5 mb-4">
      <View className="flex-row justify-between items-center">
        <Text className="text-textPrimary font-semibold text-lg">{title}</Text>
        {badge ? <Text className="text-accentHi text-xs">{badge}</Text> : null}
      </View>
      <Text className="text-textSecondary mt-2 leading-6">{description}</Text>
    </View>
  );
}
