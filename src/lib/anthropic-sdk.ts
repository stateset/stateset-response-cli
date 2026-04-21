function isSuppressedAnthropicImportWarning(warning: unknown, args: unknown[]): boolean {
  const message = warning instanceof Error ? warning.message : String(warning);
  const warningType =
    typeof args[0] === 'string' ? args[0] : warning instanceof Error ? warning.name : undefined;
  const warningCode =
    typeof args[1] === 'string'
      ? args[1]
      : typeof args[0] === 'object' && args[0] !== null && 'code' in args[0]
        ? String((args[0] as { code?: unknown }).code ?? '')
        : warning instanceof Error && 'code' in warning
          ? String((warning as Error & { code?: unknown }).code ?? '')
          : undefined;

  return (
    warningType === 'DeprecationWarning' &&
    (warningCode === 'DEP0040' || message.includes('`punycode` module is deprecated'))
  );
}

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
  if (isSuppressedAnthropicImportWarning(warning, args)) {
    return;
  }
  return Reflect.apply(originalEmitWarning, process, [warning, ...args]);
}) as typeof process.emitWarning;

const { default: Anthropic } = await import('@anthropic-ai/sdk').finally(() => {
  process.emitWarning = originalEmitWarning;
});

export default Anthropic;
