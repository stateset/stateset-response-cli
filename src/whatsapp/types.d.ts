declare module 'qrcode-terminal' {
  const qrcodeTerminal: {
    generate(
      input: string,
      opts?: { small?: boolean },
      cb?: (qrcode: string) => void,
    ): void;
    setErrorLevel(level: string): void;
  };
  export default qrcodeTerminal;
}
