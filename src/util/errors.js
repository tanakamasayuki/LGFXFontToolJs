// @ts-check
/**
 * エラー階層。すべてのエラーは安定した `code` と `details` を持つ。
 * `message` は英語の開発者向け文字列であり、ユーザー向け文言は生成しない（仕様 §12）。
 */

export class FontToolError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details ?? {};
  }
}

export class FormatError extends FontToolError {}

export class TruncatedDataError extends FormatError {
  /** @param {string} message @param {object} [details] */
  constructor(message, details) {
    super('TRUNCATED', message, details);
  }
}

export class DetectFailedError extends FormatError {
  /** @param {string} message @param {object} [details] */
  constructor(message, details) {
    super('DETECT_FAILED', message, details);
  }
}

export class UnsupportedFeatureError extends FormatError {
  /** @param {string} message @param {object} [details] */
  constructor(message, details) {
    super('UNSUPPORTED_FEATURE', message, details);
  }
}

export class EncodeConstraintError extends FontToolError {
  /**
   * @param {string} message
   * @param {import('../format/registry.js').EncodeIssue[]} issues
   */
  constructor(message, issues) {
    super('ENCODE_CONSTRAINT', message, { issues });
    this.issues = issues;
  }
}

export class CapabilityError extends FontToolError {}

export class CollectionError extends FontToolError {}
