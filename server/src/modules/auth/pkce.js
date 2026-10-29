import { createHash, createHmac } from "node:crypto";

// State is 256-bit random. A domain-separated keyed derivation lets every API
// instance recover its verifier without persisting another plaintext credential.
// Keep the matching client secret stable for the lifetime of in-flight flows.
export function oauthPkce(state, clientSecret, purpose) {
  const verifier = createHmac("sha256", clientSecret)
    .update(`pocketops:pkce:v1:${purpose}:`)
    .update(state)
    .digest("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
