/** Preserve unknown fields and invalid raw input; never keep confirmations after annotation edits. */
export function invalidateObservedGeometry(text: string): string {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return text;
    value.confirmed = false;
    if (Array.isArray(value.motions))
      for (const motion of value.motions)
        if (motion && typeof motion === 'object' && !Array.isArray(motion))
          motion.confirmed = false;
    return JSON.stringify(value, null, 2);
  } catch {
    return text;
  }
}
