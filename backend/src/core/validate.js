'use strict';

/**
 * Input validation.
 *
 * Rule: never trust anything from the browser. (spec §38) Every route validates
 * its input through here and works only with the CLEANED result — never with
 * the raw body.
 *
 * Deliberately small and readable rather than a full schema library. Swap in
 * one later if the surface grows; the call sites are all in routes/.
 */

const { validation } = require('./errors');

/**
 * Validate an object against a schema of field rules.
 *
 * @param {object} input  raw data (req.body, query…)
 * @param {object} schema field -> rule object
 * @returns {object} cleaned values (only fields present in the schema)
 *
 * Rule options:
 *   type      'string'|'number'|'integer'|'boolean'|'array'|'object'
 *   required  boolean
 *   default   value used when absent
 *   min/max   length for strings/arrays, value for numbers
 *   pattern   RegExp for strings
 *   enum      array of allowed values
 *   trim      trim a string (default true)
 *   lower     lowercase a string
 */
function validate(input, schema) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const errors = {};

  for (const [field, rule] of Object.entries(schema)) {
    let value = src[field];

    // Absent / empty handling
    if (value === undefined || value === null || value === '') {
      if (rule.default !== undefined) { out[field] = rule.default; continue; }
      if (rule.required) { errors[field] = 'This field is required.'; continue; }
      continue;
    }

    switch (rule.type) {
      case 'string': {
        if (typeof value !== 'string') value = String(value);
        if (rule.trim !== false) value = value.trim();
        if (rule.lower) value = value.toLowerCase();
        if (rule.min !== undefined && value.length < rule.min) {
          errors[field] = `Must be at least ${rule.min} characters.`; continue;
        }
        if (rule.max !== undefined && value.length > rule.max) {
          errors[field] = `Must be at most ${rule.max} characters.`; continue;
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          errors[field] = rule.message || 'This format is not valid.'; continue;
        }
        break;
      }
      case 'number':
      case 'integer': {
        const n = Number(value);
        if (!Number.isFinite(n)) { errors[field] = 'Must be a number.'; continue; }
        if (rule.type === 'integer' && !Number.isInteger(n)) {
          value = Math.trunc(n);
        } else {
          value = n;
        }
        if (rule.min !== undefined && value < rule.min) {
          errors[field] = `Must be at least ${rule.min}.`; continue;
        }
        if (rule.max !== undefined && value > rule.max) {
          errors[field] = `Must be at most ${rule.max}.`; continue;
        }
        break;
      }
      case 'boolean': {
        value = value === true || value === 'true' || value === 1 || value === '1';
        break;
      }
      case 'array': {
        if (!Array.isArray(value)) { errors[field] = 'Must be a list.'; continue; }
        if (rule.max !== undefined && value.length > rule.max) {
          errors[field] = `At most ${rule.max} items.`; continue;
        }
        if (rule.of === 'string') {
          value = value.map((v) => String(v).trim()).filter(Boolean);
        }
        break;
      }
      case 'object': {
        if (typeof value !== 'object' || Array.isArray(value)) {
          errors[field] = 'Must be an object.'; continue;
        }
        break;
      }
      default:
        break;
    }

    if (rule.enum && !rule.enum.includes(value)) {
      errors[field] = `Must be one of: ${rule.enum.join(', ')}.`;
      continue;
    }

    out[field] = value;
  }

  if (Object.keys(errors).length) {
    throw validation('Please check the highlighted fields.', errors);
  }
  return out;
}

// Reusable field rules used across several routes.
const rules = {
  username: {
    type: 'string', required: true, min: 3, max: 24, lower: true,
    pattern: /^[a-z0-9_.]+$/,
    message: 'Use 3-24 letters, numbers, underscores or dots.',
  },
  handle: {
    type: 'string', required: true, min: 3, max: 24, lower: true,
    pattern: /^[a-z0-9_.]+$/,
    message: 'Use 3-24 letters, numbers, underscores or dots.',
  },
  email: {
    type: 'string', required: true, max: 254, lower: true,
    pattern: /^[^@\s]+@[^@\s.]+\.[^@\s]+$/,
    message: 'Enter a valid email address.',
  },
  password: {
    type: 'string', required: true, min: 10, max: 200, trim: false,
    message: 'Use at least 10 characters.',
  },
};

/**
 * Escape text for safe interpolation into HTML. The API returns JSON (so the
 * browser is the one escaping), but this is here for any server-rendered
 * surface such as emails. (spec §38 — output encoding)
 */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = { validate, rules, escapeHtml };
