export function breakpointFor(width, height) {
  return { size: width < 600 ? 'compact' : width < 1024 ? 'medium' : 'expanded', compact: width < 600, width, height, landscape: width > height };
}
