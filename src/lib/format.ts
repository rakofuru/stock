function formatter(digits: number) {
  return new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  return formatter(digits).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  return `${formatNumber(value, digits)}%`;
}

export function formatSigned(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, digits)}`;
}

export function signedClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "";
  }
  if (value < 0) {
    return "num-negative";
  }
  if (value > 0) {
    return "num-positive";
  }
  return "num-zero";
}
