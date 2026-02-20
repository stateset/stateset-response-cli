export interface OptionValueResult {
  value: string;
  index: number;
}

export interface OptionToken {
  option: string;
  inlineValue?: string;
}

export function parseCommaSeparated(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

export function splitOptionToken(token: string): OptionToken {
  const equalIndex = token.indexOf('=');
  if (equalIndex === -1) {
    return { option: token };
  }
  return {
    option: token.slice(0, equalIndex),
    inlineValue: token.slice(equalIndex + 1),
  };
}

export function isOptionToken(value: string): boolean {
  return value.startsWith('-');
}

export function readOptionValue(
  args: string[],
  currentIndex: number,
  optionName: string,
  inlineValue?: string,
): OptionValueResult {
  const value = inlineValue ?? args[currentIndex + 1];
  const missingValue =
    value === undefined ||
    value.length === 0 ||
    (inlineValue === undefined && isOptionToken(value));
  if (missingValue) {
    throw new Error(`Missing value for ${optionName}.`);
  }

  return {
    value,
    index: inlineValue === undefined ? currentIndex + 1 : currentIndex,
  };
}
