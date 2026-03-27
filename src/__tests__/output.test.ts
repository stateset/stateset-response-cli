import { describe, it, expect, beforeEach, vi, afterEach, type SpyInstance } from 'vitest';
import {
  setOutputMode,
  getOutputMode,
  isJsonMode,
  output,
  outputSuccess,
  outputError,
  outputWarn,
} from '../lib/output.js';

describe('output', () => {
  let stdoutWrite: SpyInstance;
  let stderrWrite: SpyInstance;
  let consoleLog: SpyInstance;
  let consoleError: SpyInstance;

  beforeEach(() => {
    setOutputMode('pretty'); // reset to default
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setOutputMode('pretty');
  });

  describe('setOutputMode / getOutputMode', () => {
    it('defaults to pretty', () => {
      expect(getOutputMode()).toBe('pretty');
    });

    it('sets and returns json mode', () => {
      setOutputMode('json');
      expect(getOutputMode()).toBe('json');
    });

    it('sets and returns minimal mode', () => {
      setOutputMode('minimal');
      expect(getOutputMode()).toBe('minimal');
    });
  });

  describe('isJsonMode', () => {
    it('returns true when mode is json', () => {
      setOutputMode('json');
      expect(isJsonMode()).toBe(true);
    });

    it('returns false when mode is pretty', () => {
      setOutputMode('pretty');
      expect(isJsonMode()).toBe(false);
    });

    it('returns false when mode is minimal', () => {
      setOutputMode('minimal');
      expect(isJsonMode()).toBe(false);
    });
  });

  describe('output()', () => {
    it('in json mode writes JSON to stdout', () => {
      setOutputMode('json');
      const data = { name: 'test', value: 42 };
      output(data);
      expect(stdoutWrite).toHaveBeenCalledWith(JSON.stringify(data, null, 2) + '\n');
    });

    it('in json mode serializes arrays', () => {
      setOutputMode('json');
      const data = [1, 2, 3];
      output(data);
      expect(stdoutWrite).toHaveBeenCalledWith(JSON.stringify(data, null, 2) + '\n');
    });

    it('in minimal mode writes each array item per line', () => {
      setOutputMode('minimal');
      output(['one', 'two', 'three']);
      expect(stdoutWrite).toHaveBeenCalledWith('one\n');
      expect(stdoutWrite).toHaveBeenCalledWith('two\n');
      expect(stdoutWrite).toHaveBeenCalledWith('three\n');
    });

    it('in minimal mode JSON-stringifies non-string array items', () => {
      setOutputMode('minimal');
      output([{ a: 1 }]);
      expect(stdoutWrite).toHaveBeenCalledWith(JSON.stringify({ a: 1 }) + '\n');
    });

    it('in minimal mode writes strings directly', () => {
      setOutputMode('minimal');
      output('hello');
      expect(stdoutWrite).toHaveBeenCalledWith('hello\n');
    });

    it('in minimal mode JSON-stringifies objects', () => {
      setOutputMode('minimal');
      const data = { key: 'val' };
      output(data);
      expect(stdoutWrite).toHaveBeenCalledWith(JSON.stringify(data) + '\n');
    });

    it('in pretty mode logs strings to console', () => {
      setOutputMode('pretty');
      output('hello world');
      expect(consoleLog).toHaveBeenCalledWith('  hello world');
    });

    it('in pretty mode prints a label when provided', () => {
      setOutputMode('pretty');
      output('data', { label: 'Results' });
      expect(consoleLog).toHaveBeenCalledTimes(2);
    });
  });

  describe('outputSuccess', () => {
    it('in json mode writes status ok to stdout', () => {
      setOutputMode('json');
      outputSuccess('it worked');
      expect(stdoutWrite).toHaveBeenCalledWith(
        JSON.stringify({ status: 'ok', message: 'it worked' }) + '\n',
      );
    });

    it('in pretty mode logs green text', () => {
      setOutputMode('pretty');
      outputSuccess('done');
      expect(consoleLog).toHaveBeenCalled();
      const callArg = consoleLog.mock.calls[0][0] as string;
      expect(callArg).toContain('done');
    });
  });

  describe('outputError', () => {
    it('in json mode writes status error to stderr', () => {
      setOutputMode('json');
      outputError('bad thing', { code: 'ERR_001' });
      const written = stderrWrite.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual({
        status: 'error',
        message: 'bad thing',
        code: 'ERR_001',
      });
    });

    it('in json mode writes without details', () => {
      setOutputMode('json');
      outputError('fail');
      const written = stderrWrite.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual({
        status: 'error',
        message: 'fail',
      });
    });

    it('in pretty mode writes to console.error', () => {
      setOutputMode('pretty');
      outputError('something broke');
      expect(consoleError).toHaveBeenCalled();
      const callArg = consoleError.mock.calls[0][0] as string;
      expect(callArg).toContain('something broke');
    });
  });

  describe('outputWarn', () => {
    it('in json mode writes status warning to stderr', () => {
      setOutputMode('json');
      outputWarn('watch out');
      const written = stderrWrite.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual({
        status: 'warning',
        message: 'watch out',
      });
    });

    it('in pretty mode logs to console', () => {
      setOutputMode('pretty');
      outputWarn('heads up');
      expect(consoleLog).toHaveBeenCalled();
      const callArg = consoleLog.mock.calls[0][0] as string;
      expect(callArg).toContain('heads up');
    });
  });
});
