export function encodeUtf8(value) {
  let percentEncoded;
  try {
    percentEncoded = encodeURIComponent(value);
  } catch {
    throw new Error("Text contains an invalid Unicode sequence");
  }
  const bytes = [];
  for (let index = 0; index < percentEncoded.length; ) {
    if (percentEncoded[index] === "%") {
      bytes.push(Number.parseInt(percentEncoded.slice(index + 1, index + 3), 16));
      index += 3;
    } else {
      bytes.push(percentEncoded.charCodeAt(index));
      index += 1;
    }
  }
  return Uint8Array.from(bytes);
}

export function decodeUtf8(bytes) {
  let encoded = "";
  for (const byte of bytes) encoded += `%${byte.toString(16).padStart(2, "0")}`;
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new Error("Encrypted draft contains invalid text");
  }
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64(bytes) {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | (second >> 4)];
    output += hasSecond ? alphabet[((second & 15) << 2) | (third >> 6)] : "=";
    output += hasThird ? alphabet[third & 63] : "=";
  }
  return output;
}

export function decodeBase64(value) {
  if (
    typeof value !== "string" ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("Encrypted draft is invalid");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let offset = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index]);
    const b = alphabet.indexOf(value[index + 1]);
    const c = value[index + 2] === "=" ? 0 : alphabet.indexOf(value[index + 2]);
    const d = value[index + 3] === "=" ? 0 : alphabet.indexOf(value[index + 3]);
    const combined = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < bytes.length) bytes[offset++] = (combined >> 16) & 255;
    if (offset < bytes.length) bytes[offset++] = (combined >> 8) & 255;
    if (offset < bytes.length) bytes[offset++] = combined & 255;
  }
  return bytes;
}

