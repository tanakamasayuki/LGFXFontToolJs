// @ts-check
/**
 * Error hierarchy. Every error has stable `code` and `details` fields.
 * `message` is English developer text, never user-facing copy (spec §12).
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
