// @ts-check
/**
 * Drawing datum with the same bit layout as LovyanGFX textdatum_t:
 * horizontal 0:left 1:center 2:right / vertical 0:top 4:middle 8:bottom 16:baseline
 */

/** @typedef {keyof typeof DATUM} DatumName */

export const DATUM = Object.freeze({
  'top-left': 0,
  'top-center': 1,
  'top-right': 2,
  'middle-left': 4,
  'middle-center': 5,
  'middle-right': 6,
  'bottom-left': 8,
  'bottom-center': 9,
  'bottom-right': 10,
  'baseline-left': 16,
  'baseline-center': 17,
  'baseline-right': 18,
});

/**
 * @param {string | number | undefined} datum
 * @returns {number}
 */
export function resolveDatum(datum) {
  if (datum === undefined) return 0;
  if (typeof datum === 'number') return datum;
  const v = DATUM[/** @type {DatumName} */ (datum)];
  if (v === undefined) throw new RangeError(`unknown datum: ${datum}`);
  return v;
}
