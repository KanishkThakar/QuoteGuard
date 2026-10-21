// API ratio fields have six decimal places; the percentage inputs have four.
export function ratioToPercent(ratio: string): string {
  return String(Number((Number(ratio) * 100).toFixed(4)));
}

export function percentToRatio(percent: string): string {
  return (Number(percent) / 100).toFixed(6);
}
