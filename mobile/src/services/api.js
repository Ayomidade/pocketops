const API_URL =
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000/api/v1";
export async function getApiHealth() {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) throw new Error("API unavailable");
  return response.json();
}
// Never embed GitHub installation tokens or deployment-provider credentials in mobile code.
